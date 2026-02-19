import { Prisma, NfeStatus } from "@prisma/client";
import { XMLParser } from "fast-xml-parser";
import { encryptBuffer } from "../lib/crypto.js";
import { prisma } from "../lib/prisma.js";

const xmlParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "",
  trimValues: true,
});

interface ImportOptions {
  status: NfeStatus;
  nsu?: string | null;
}

interface ParsedItem {
  codigo: string | null;
  descricao: string | null;
  ncm: string | null;
  cfop: string | null;
  qtd: number;
  vUnit: number;
  vTotal: number;
}

interface ParsedNfe {
  chave: string;
  emitenteCnpj: string | null;
  emitenteNome: string | null;
  valorTotal: number;
  dataEmissao: Date | null;
  dataVencimento: Date | null;
  tipoOperacao: string | null;
  items: ParsedItem[];
}

function toArray<T>(value: T | T[] | null | undefined): T[] {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

function parseNumber(value: unknown): number {
  const num = Number(String(value ?? "0").replace(",", "."));
  return Number.isFinite(num) ? num : 0;
}

function parseDate(value: unknown): Date | null {
  if (value === null || value === undefined) {
    return null;
  }

  const raw = String(value).trim();
  if (!raw) {
    return null;
  }

  const dateOnlyMatch = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (dateOnlyMatch) {
    const year = Number(dateOnlyMatch[1]);
    const month = Number(dateOnlyMatch[2]);
    const day = Number(dateOnlyMatch[3]);
    const localDate = new Date(year, month - 1, day, 0, 0, 0, 0);
    return Number.isNaN(localDate.getTime()) ? null : localDate;
  }

  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function findInfNfe(root: unknown): Record<string, any> | null {
  if (!root || typeof root !== "object") {
    return null;
  }

  const record = root as Record<string, unknown>;
  if (record.infNFe && typeof record.infNFe === "object") {
    return record.infNFe as Record<string, any>;
  }

  for (const value of Object.values(record)) {
    const found = findInfNfe(value);
    if (found) {
      return found;
    }
  }

  return null;
}

function findChave(parsed: any, infNfe: Record<string, any>): string {
  const fromId = typeof infNfe.Id === "string" ? infNfe.Id.replace(/^NFe/, "") : null;
  const fromProt = parsed?.nfeProc?.protNFe?.infProt?.chNFe;

  const key = fromId || fromProt;
  if (!key || typeof key !== "string") {
    throw new Error("Nao foi possivel identificar a chave da NF-e no XML");
  }

  return key;
}

function parseXml(xml: string): ParsedNfe {
  const parsed = xmlParser.parse(xml);
  const infNfe = findInfNfe(parsed);

  if (!infNfe) {
    throw new Error("XML de NF-e invalido");
  }

  const emit = (infNfe.emit as Record<string, any> | undefined) ?? {};
  const ide = (infNfe.ide as Record<string, any> | undefined) ?? {};
  const total = (infNfe.total?.ICMSTot as Record<string, any> | undefined) ?? {};
  const cobr = (infNfe.cobr as Record<string, any> | undefined) ?? {};
  const duplicatas = toArray(cobr.dup);

  const items = toArray(infNfe.det).map((det: any) => {
    const prod = (det?.prod ?? {}) as Record<string, unknown>;

    return {
      codigo: prod.cProd ? String(prod.cProd) : null,
      descricao: prod.xProd ? String(prod.xProd) : null,
      ncm: prod.NCM ? String(prod.NCM) : null,
      cfop: prod.CFOP ? String(prod.CFOP) : null,
      qtd: parseNumber(prod.qCom),
      vUnit: parseNumber(prod.vUnCom),
      vTotal: parseNumber(prod.vProd),
    };
  });

  const dhEmiRaw = ide.dhEmi ?? ide.dEmi ?? null;
  const dueDates = duplicatas
    .map((dup) => parseDate((dup as Record<string, unknown> | null | undefined)?.dVenc))
    .filter((value): value is Date => value instanceof Date)
    .sort((a, b) => a.getTime() - b.getTime());

  return {
    chave: findChave(parsed, infNfe),
    emitenteCnpj: emit.CNPJ ? String(emit.CNPJ) : null,
    emitenteNome: emit.xNome ? String(emit.xNome) : null,
    valorTotal: parseNumber(total.vNF),
    dataEmissao: parseDate(dhEmiRaw),
    dataVencimento: dueDates[0] ?? null,
    tipoOperacao: ide.tpNF ? String(ide.tpNF) : null,
    items,
  };
}

export async function importNfeXml(companyId: string, xml: string, options: ImportOptions) {
  const parsed = parseXml(xml);
  const encryptedXml = new Uint8Array(encryptBuffer(Buffer.from(xml, "utf8")));

  return prisma.$transaction(async (tx) => {
    const existing = await tx.nfeDocument.findUnique({
      where: {
        companyId_chave: {
          companyId,
          chave: parsed.chave,
        },
      },
    });

    const importedAt = options.status === "imported" ? new Date() : null;

    if (existing) {
      const updated = await tx.nfeDocument.update({
        where: { id: existing.id },
        data: {
          nsu: options.nsu ?? existing.nsu,
          emitenteCnpj: parsed.emitenteCnpj,
          emitenteNome: parsed.emitenteNome,
          valorTotal: new Prisma.Decimal(parsed.valorTotal),
          dataEmissao: parsed.dataEmissao,
          dataVencimento: parsed.dataVencimento,
          tipoOperacao: parsed.tipoOperacao,
          rawXmlBlobEncrypted: encryptedXml,
          status: options.status,
          importedAt,
          items: {
            deleteMany: {},
            create: parsed.items.map((item) => ({
              codigo: item.codigo,
              descricao: item.descricao,
              ncm: item.ncm,
              cfop: item.cfop,
              qtd: new Prisma.Decimal(item.qtd),
              vUnit: new Prisma.Decimal(item.vUnit),
              vTotal: new Prisma.Decimal(item.vTotal),
            })),
          },
        },
        include: { items: true },
      });

      return updated;
    }

    const created = await tx.nfeDocument.create({
      data: {
        companyId,
        chave: parsed.chave,
        nsu: options.nsu ?? null,
        emitenteCnpj: parsed.emitenteCnpj,
        emitenteNome: parsed.emitenteNome,
        valorTotal: new Prisma.Decimal(parsed.valorTotal),
        dataEmissao: parsed.dataEmissao,
        dataVencimento: parsed.dataVencimento,
        tipoOperacao: parsed.tipoOperacao,
        rawXmlBlobEncrypted: encryptedXml,
        status: options.status,
        importedAt,
        items: {
          create: parsed.items.map((item) => ({
            codigo: item.codigo,
            descricao: item.descricao,
            ncm: item.ncm,
            cfop: item.cfop,
            qtd: new Prisma.Decimal(item.qtd),
            vUnit: new Prisma.Decimal(item.vUnit),
            vTotal: new Prisma.Decimal(item.vTotal),
          })),
        },
      },
      include: { items: true },
    });

    return created;
  });
}
