import https from "node:https";
import zlib from "node:zlib";
import axios from "axios";
import { XMLParser } from "fast-xml-parser";
import { BR_UF_CODES, resolveUfCodeFromPfx } from "../lib/certificate.js";
import { decryptBuffer, decryptText } from "../lib/crypto.js";
import { prisma } from "../lib/prisma.js";
import { appConfigService, type OperationalSettings } from "./app-config.service.js";

export interface DfeDocumentResult {
  nsu: string;
  xml: string;
}

interface ParsedDistDocument {
  nsu: string;
  schema: string;
  xml: string;
}

interface ParsedDistResponse {
  cStat: string;
  xMotivo: string;
  ultNSU: string;
  maxNSU: string;
  documents: ParsedDistDocument[];
}

export class SefazDfeError extends Error {
  public readonly cStat: string;
  public readonly xMotivo: string;
  public readonly cUfAutor: number;
  public readonly ultNSU: string | null;
  public readonly maxNSU: string | null;

  constructor(cStat: string, xMotivo: string, cUfAutor: number, options?: { ultNSU?: string | null; maxNSU?: string | null }) {
    super(`SEFAZ DF-e retornou cStat ${cStat}: ${xMotivo} (cUFAutor=${cUfAutor})`);
    this.name = "SefazDfeError";
    this.cStat = cStat;
    this.xMotivo = xMotivo;
    this.cUfAutor = cUfAutor;
    this.ultNSU = options?.ultNSU ?? null;
    this.maxNSU = options?.maxNSU ?? null;
  }
}

const SOAP_ACTION = "http://www.portalfiscal.inf.br/nfe/wsdl/NFeDistribuicaoDFe/nfeDistDFeInteresse";
const NSU_LENGTH = 15;
const EMPTY_NSU = "000000000000000";

const xmlParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "",
  trimValues: true,
  processEntities: true,
});

function toArray<T>(value: T | T[] | null | undefined): T[] {
  if (!value) {
    return [];
  }

  return Array.isArray(value) ? value : [value];
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function localName(key: string): string {
  const noPrefix = key.includes(":") ? key.split(":").pop() ?? key : key;
  return noPrefix.replace(/^@_/, "");
}

function readText(value: unknown): string {
  if (typeof value === "string") {
    return value.trim();
  }

  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }

  const record = asRecord(value);
  if (!record) {
    return "";
  }

  const direct = ["#text", "__text", "__cdata", "$text", "_text", "value"]
    .map((key) => record[key])
    .map((item) => (typeof item === "string" ? item.trim() : ""))
    .find((item) => item.length > 0);

  return direct ?? "";
}

function readRecordText(record: Record<string, unknown>, keys: string[]): string {
  for (const key of keys) {
    const value = readText(record[key]);
    if (value.length > 0) {
      return value;
    }
  }

  return "";
}

function findValueByLocalName(value: unknown, targetLocalName: string): unknown {
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findValueByLocalName(item, targetLocalName);
      if (found !== undefined) {
        return found;
      }
    }

    return undefined;
  }

  const record = asRecord(value);
  if (!record) {
    return undefined;
  }

  for (const [key, child] of Object.entries(record)) {
    if (localName(key) === targetLocalName) {
      return child;
    }

    const nested = findValueByLocalName(child, targetLocalName);
    if (nested !== undefined) {
      return nested;
    }
  }

  return undefined;
}

function findNodeByLocalName(value: unknown, targetLocalName: string): Record<string, unknown> | null {
  const found = findValueByLocalName(value, targetLocalName);
  return asRecord(found);
}

function normalizeNsu(value: string | null | undefined): string {
  const digits = String(value ?? "").replace(/\D/g, "");
  if (!digits) {
    return EMPTY_NSU;
  }

  return digits.padStart(NSU_LENGTH, "0").slice(-NSU_LENGTH);
}

function normalizeCnpj(value: string): string {
  const digits = value.replace(/\D/g, "");
  if (digits.length !== 14) {
    throw new Error("CNPJ da empresa invalido para consulta DF-e");
  }

  return digits;
}

function resolveDistEndpoint(settings: OperationalSettings): string {
  return settings.sefazTpAmb === 2 ? settings.sefazNfeDistHomologUrl : settings.sefazNfeDistProdUrl;
}

function looksLikeImportableNfeXml(xml: string): boolean {
  const trimmed = xml.trimStart().toLowerCase();
  if (!trimmed.startsWith("<")) {
    return false;
  }

  const preview = trimmed.slice(0, 600);
  return (
    preview.includes("<nfeproc") ||
    preview.includes("<procnfe") ||
    preview.includes("<nfe ") ||
    preview.includes("<nfe>")
  );
}

function isImportableSchema(schema: string): boolean {
  const normalized = schema.trim().toLowerCase();
  return normalized.startsWith("procnfe");
}

function isValidUfCode(value: number): boolean {
  return BR_UF_CODES.includes(value);
}

function resolveCUFAutorCandidates(
  pfxBuffer: Buffer,
  pfxPassword: string,
  settings: OperationalSettings,
): number[] {
  const candidates: number[] = [];
  const push = (value: number | null | undefined) => {
    if (typeof value !== "number" || !Number.isInteger(value) || !isValidUfCode(value)) {
      return;
    }

    if (!candidates.includes(value)) {
      candidates.push(value);
    }
  };

  try {
    push(resolveUfCodeFromPfx(pfxBuffer, pfxPassword));
  } catch {
    // segue para fallback de ambiente.
  }

  push(settings.sefazCUFAutor);

  for (const code of BR_UF_CODES) {
    push(code);
  }

  return candidates;
}

function buildDistRequestXml(cnpj: string, ultNsu: string, cUfAutor: number, settings: OperationalSettings): string {
  return [
    '<distDFeInt xmlns="http://www.portalfiscal.inf.br/nfe" versao="1.01">',
    `  <tpAmb>${settings.sefazTpAmb}</tpAmb>`,
    `  <cUFAutor>${cUfAutor}</cUFAutor>`,
    `  <CNPJ>${cnpj}</CNPJ>`,
    "  <distNSU>",
    `    <ultNSU>${ultNsu}</ultNSU>`,
    "  </distNSU>",
    "</distDFeInt>",
  ].join("\n");
}

function buildSoap11Envelope(nfeRequestXml: string): string {
  return [
    '<?xml version="1.0" encoding="utf-8"?>',
    '<soap:Envelope xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"',
    '               xmlns:xsd="http://www.w3.org/2001/XMLSchema"',
    '               xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">',
    "  <soap:Body>",
    '    <nfeDistDFeInteresse xmlns="http://www.portalfiscal.inf.br/nfe/wsdl/NFeDistribuicaoDFe">',
    "      <nfeDadosMsg>",
    nfeRequestXml,
    "      </nfeDadosMsg>",
    "    </nfeDistDFeInteresse>",
    "  </soap:Body>",
    "</soap:Envelope>",
  ].join("\n");
}

function buildSoap12Envelope(nfeRequestXml: string): string {
  return [
    '<?xml version="1.0" encoding="utf-8"?>',
    '<soap12:Envelope xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"',
    '                 xmlns:xsd="http://www.w3.org/2001/XMLSchema"',
    '                 xmlns:soap12="http://www.w3.org/2003/05/soap-envelope">',
    "  <soap12:Body>",
    '    <nfeDistDFeInteresse xmlns="http://www.portalfiscal.inf.br/nfe/wsdl/NFeDistribuicaoDFe">',
    "      <nfeDadosMsg>",
    nfeRequestXml,
    "      </nfeDadosMsg>",
    "    </nfeDistDFeInteresse>",
    "  </soap12:Body>",
    "</soap12:Envelope>",
  ].join("\n");
}

function decodeDocZip(base64Content: string): string {
  const zipped = Buffer.from(base64Content, "base64");
  return zlib.gunzipSync(zipped).toString("utf8");
}

function extractRetDistNode(responseXml: string): Record<string, unknown> {
  const parsed = xmlParser.parse(responseXml);

  const directRet = findNodeByLocalName(parsed, "retDistDFeInt");
  if (directRet) {
    return directRet;
  }

  const resultValue = findValueByLocalName(parsed, "nfeDistDFeInteresseResult");
  const resultText = readText(resultValue);
  if (resultText) {
    const innerParsed = xmlParser.parse(resultText);
    const innerRet = findNodeByLocalName(innerParsed, "retDistDFeInt");
    if (innerRet) {
      return innerRet;
    }
  }

  throw new Error("Resposta da SEFAZ sem retDistDFeInt");
}

function parseDistResponse(responseXml: string): ParsedDistResponse {
  const retNode = extractRetDistNode(responseXml);

  const cStat = readRecordText(retNode, ["cStat"]);
  const xMotivo = readRecordText(retNode, ["xMotivo"]);
  const ultNSU = normalizeNsu(readRecordText(retNode, ["ultNSU"]));
  const maxNSU = normalizeNsu(readRecordText(retNode, ["maxNSU"]));

  const loteNode = asRecord(retNode.loteDistDFeInt);
  const rawDocs = loteNode ? toArray(loteNode.docZip) : [];
  const documents: ParsedDistDocument[] = [];

  for (const rawDoc of rawDocs) {
    const docNode = asRecord(rawDoc);
    const schema = docNode ? readRecordText(docNode, ["schema", "@_schema"]) : "";
    const nsu = normalizeNsu(docNode ? readRecordText(docNode, ["NSU", "nsu", "@_NSU", "@_nsu"]) : "");
    const base64 = docNode ? readRecordText(docNode, ["#text", "__text", "__cdata", "$text", "_text", "value"]) : readText(rawDoc);

    if (!base64) {
      continue;
    }

    let xml: string;
    try {
      xml = decodeDocZip(base64);
    } catch {
      continue;
    }

    if (schema && !isImportableSchema(schema) && !looksLikeImportableNfeXml(xml)) {
      continue;
    }

    if (!looksLikeImportableNfeXml(xml)) {
      continue;
    }

    documents.push({
      nsu,
      schema,
      xml,
    });
  }

  return {
    cStat,
    xMotivo,
    ultNSU,
    maxNSU,
    documents,
  };
}

function extractAxiosErrorMessage(error: unknown): string {
  if (axios.isAxiosError(error)) {
    const status = error.response?.status;
    const data = error.response?.data;
    const body = typeof data === "string" ? data.slice(0, 250) : "";
    if (status) {
      return `HTTP ${status}${body ? ` - ${body}` : ""}`;
    }

    return error.message;
  }

  return error instanceof Error ? error.message : "Erro desconhecido";
}

async function postSoapRequest(
  endpoint: string,
  body: string,
  agent: https.Agent,
  headers: Record<string, string>,
  timeoutMs: number,
): Promise<string> {
  const response = await axios.post<string>(endpoint, body, {
    httpsAgent: agent,
    timeout: timeoutMs,
    responseType: "text",
    transformResponse: [(data) => data as string],
    headers,
  });

  return typeof response.data === "string" ? response.data : String(response.data ?? "");
}

async function requestDistDfe(
  endpoint: string,
  nfeRequestXml: string,
  agent: https.Agent,
  timeoutMs: number,
): Promise<string> {
  const attempts: Array<{
    name: string;
    envelope: string;
    headers: Record<string, string>;
  }> = [
    {
      name: "soap11",
      envelope: buildSoap11Envelope(nfeRequestXml),
      headers: {
        "Content-Type": "text/xml; charset=utf-8",
        SOAPAction: `"${SOAP_ACTION}"`,
      },
    },
    {
      name: "soap12",
      envelope: buildSoap12Envelope(nfeRequestXml),
      headers: {
        "Content-Type": `application/soap+xml; charset=utf-8; action="${SOAP_ACTION}"`,
      },
    },
  ];

  let lastError = "Erro desconhecido";

  for (const attempt of attempts) {
    try {
      return await postSoapRequest(endpoint, attempt.envelope, agent, attempt.headers, timeoutMs);
    } catch (error) {
      lastError = `${attempt.name}: ${extractAxiosErrorMessage(error)}`;
    }
  }

  throw new Error(`Falha na comunicacao com SEFAZ DF-e: ${lastError}`);
}

class DfeSyncService {
  async fetchNewDocuments(companyId: string): Promise<{ documents: DfeDocumentResult[]; nextNsu: string | null }> {
    const settings = await appConfigService.getSettings();
    const [state, company, certificate] = await Promise.all([
      prisma.dfeSyncState.findUnique({ where: { companyId } }),
      prisma.company.findUnique({
        where: { id: companyId },
        select: { cnpj: true },
      }),
      prisma.companyCertificate.findFirst({
        where: { companyId, active: true },
        orderBy: { createdAt: "desc" },
      }),
    ]);

    const fallbackNsu = normalizeNsu(state?.ultimoNsu);

    if (!company) {
      throw new Error("Empresa nao encontrada para sync DF-e");
    }

    if (!certificate) {
      return {
        documents: [],
        nextNsu: fallbackNsu,
      };
    }

    const cnpj = normalizeCnpj(company.cnpj);
    const endpoint = resolveDistEndpoint(settings);
    const pfxBuffer = decryptBuffer(Buffer.from(certificate.pfxBlobEncrypted));
    const pfxPassword = decryptText(Buffer.from(certificate.pfxPasswordEncrypted));
    const cUfCandidates = resolveCUFAutorCandidates(pfxBuffer, pfxPassword, settings);

    if (cUfCandidates.length === 0) {
      throw new Error("Nao foi possivel definir cUFAutor para consulta DF-e");
    }

    const agent = new https.Agent({
      pfx: pfxBuffer,
      passphrase: pfxPassword,
      keepAlive: false,
      minVersion: "TLSv1.2",
    });

    let currentNsu = fallbackNsu;
    let nextNsu = fallbackNsu;
    const documents: DfeDocumentResult[] = [];
    const seenNsu = new Set<string>();
    let cUfIndex = 0;

    try {
      for (let batch = 0; batch < settings.sefazMaxBatchesPerSync; batch += 1) {
        let parsed: ParsedDistResponse | null = null;

        while (!parsed) {
          const currentCUF = cUfCandidates[cUfIndex]!;
          const distRequestXml = buildDistRequestXml(cnpj, currentNsu, currentCUF, settings);
          const responseXml = await requestDistDfe(endpoint, distRequestXml, agent, settings.sefazTimeoutMs);
          const candidate = parseDistResponse(responseXml);

          if (candidate.cStat === "215" && cUfIndex < cUfCandidates.length - 1) {
            cUfIndex += 1;
            continue;
          }

          parsed = candidate;
        }

        const currentCUF = cUfCandidates[cUfIndex]!;

        if (parsed.cStat !== "137" && parsed.cStat !== "138") {
          const motivo = parsed.xMotivo || "Sem motivo informado";
          throw new SefazDfeError(parsed.cStat, motivo, currentCUF, {
            ultNSU: parsed.ultNSU,
            maxNSU: parsed.maxNSU,
          });
        }

        nextNsu = normalizeNsu(parsed.ultNSU || currentNsu);

        for (const doc of parsed.documents) {
          const nsu = normalizeNsu(doc.nsu || nextNsu);
          if (seenNsu.has(nsu)) {
            continue;
          }

          seenNsu.add(nsu);
          documents.push({
            nsu,
            xml: doc.xml,
          });
        }

        const reachedMaxNsu = nextNsu === normalizeNsu(parsed.maxNSU);
        const hasMore = parsed.cStat === "138" && !reachedMaxNsu;

        if (!hasMore || nextNsu === currentNsu) {
          break;
        }

        currentNsu = nextNsu;
      }
    } finally {
      agent.destroy();
    }

    return {
      documents,
      nextNsu,
    };
  }
}

export const dfeSyncService = new DfeSyncService();
