import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { parse } from "csv-parse/sync";
import { BillingDocumentStatus, PrismaClient } from "@prisma/client";

const DEFAULT_DOCUMENTS_FILE = "Documentos.csv";
const DEFAULT_SUPPLIERS_FILE = "Fornecedores.csv";

interface CsvImportOptions {
  fornecedoresPath?: string;
  documentosPath?: string;
}

export interface BillingCsvImportResult {
  suppliersCreated: number;
  suppliersUpdated: number;
  documentsCreated: number;
  documentsUpdated: number;
  suppliersTotal: number;
  documentsTotal: number;
  skippedDocuments: number;
  fornecedoresPath: string;
  documentosPath: string;
}

type CsvRow = Record<string, string>;

interface SupplierInput {
  externalCode: string;
  name: string;
  city: string | null;
  document: string | null;
}

interface DocumentInput {
  supplierCode: string;
  externalKey: string;
  description: string;
  duplicateNumber: string | null;
  installment: number | null;
  amount: number;
  dueDate: Date;
  issueDate: Date | null;
  paidAt: Date | null;
  status: BillingDocumentStatus;
  operationType: string | null;
  boletoLine: string | null;
  barcode: string | null;
  ourNumber: string | null;
}

function normalizeCell(value: unknown): string | null {
  if (value === null || value === undefined) {
    return null;
  }

  const text = String(value).trim();
  return text.length > 0 ? text : null;
}

function findColumnValue(row: CsvRow, columnName: string): string | null {
  const target = columnName.trim().toUpperCase();

  for (const [key, value] of Object.entries(row)) {
    if (key.trim().toUpperCase() === target) {
      return normalizeCell(value);
    }
  }

  return null;
}

function findBlankColumnValue(row: CsvRow): string | null {
  for (const [key, value] of Object.entries(row)) {
    if (key.trim().length === 0) {
      return normalizeCell(value);
    }
  }

  return null;
}

function parseNumberPtBr(value: string | null): number | null {
  if (!value) {
    return null;
  }

  const normalized = value
    .replace(/\s+/g, "")
    .replace(/\./g, "")
    .replace(/,/g, ".")
    .replace(/[^0-9.-]/g, "");

  if (!normalized || normalized === "." || normalized === "-") {
    return null;
  }

  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseInteger(value: string | null): number | null {
  if (!value) {
    return null;
  }

  const parsed = Number.parseInt(value.replace(/\D/g, ""), 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function parsePtBrDate(value: string | null): Date | null {
  if (!value) {
    return null;
  }

  const match = value.match(/^(\d{2})\/(\d{2})\/(\d{4})(?:\s+(\d{2}):(\d{2})(?::(\d{2}))?)?$/);
  if (!match) {
    return null;
  }

  const day = Number(match[1]);
  const month = Number(match[2]);
  const year = Number(match[3]);
  const hour = Number(match[4] ?? 0);
  const minute = Number(match[5] ?? 0);
  const second = Number(match[6] ?? 0);

  const date = new Date(year, month - 1, day, hour, minute, second);

  if (
    date.getFullYear() !== year ||
    date.getMonth() !== month - 1 ||
    date.getDate() !== day ||
    date.getHours() !== hour ||
    date.getMinutes() !== minute ||
    date.getSeconds() !== second
  ) {
    return null;
  }

  return date;
}

function normalizeDigits(value: string | null): string | null {
  if (!value) {
    return null;
  }

  const digits = value.replace(/\D/g, "");
  return digits.length > 0 ? digits : null;
}

function toBillingStatus(dueDate: Date, paidAt: Date | null): BillingDocumentStatus {
  if (paidAt) {
    return "paid";
  }

  const due = new Date(dueDate);
  due.setHours(0, 0, 0, 0);

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  return due < today ? "overdue" : "pending";
}

function extractDocumentFromSupplierName(name: string): string | null {
  const tokens = name.match(/\d+/g);
  if (!tokens || tokens.length === 0) {
    return null;
  }

  for (const token of tokens) {
    if (token.length === 11 || token.length === 14) {
      return token;
    }
  }

  const collapsed = tokens.join("");
  if (collapsed.length === 11 || collapsed.length === 14) {
    return collapsed;
  }

  return null;
}

function buildDescription(input: {
  duplicateNumber: string | null;
  installment: number | null;
  operationType: string | null;
  dueDate: Date;
}): string {
  const parts: string[] = [];

  if (input.duplicateNumber) {
    parts.push(`Duplicata ${input.duplicateNumber}`);
  }

  if (input.installment !== null) {
    parts.push(`Parcela ${input.installment}`);
  }

  if (input.operationType) {
    parts.push(`Operacao ${input.operationType}`);
  }

  if (parts.length === 0) {
    parts.push(`Titulo ${input.dueDate.toLocaleDateString("pt-BR")}`);
  }

  return parts.join(" | ");
}

function buildExternalKey(input: {
  supplierCode: string;
  duplicateNumber: string | null;
  installment: number | null;
  dueDateRaw: string | null;
  amountRaw: string | null;
  ourNumber: string | null;
  barcode: string | null;
  boletoLine: string | null;
  rowSequence: string;
}): string {
  const source = [
    input.supplierCode,
    input.duplicateNumber ?? "",
    input.installment !== null ? String(input.installment) : "",
    input.dueDateRaw ?? "",
    input.amountRaw ?? "",
    input.ourNumber ?? "",
    input.barcode ?? "",
    input.boletoLine ?? "",
    input.rowSequence,
  ].join("|");

  const hash = createHash("sha256").update(source).digest("hex").slice(0, 40);
  return `${input.supplierCode}:${hash}`;
}

function resolveCsvFilePath(fileName: string, explicitPath?: string): string {
  const candidates = [
    explicitPath,
    path.resolve(process.cwd(), fileName),
    path.resolve(process.cwd(), "..", fileName),
    path.resolve(process.cwd(), "..", "..", fileName),
    path.resolve(process.cwd(), "..", "..", "..", fileName),
  ].filter((value): value is string => Boolean(value));

  for (const candidate of candidates) {
    const absolute = path.resolve(candidate);
    if (fs.existsSync(absolute) && fs.statSync(absolute).isFile()) {
      return absolute;
    }
  }

  throw new Error(`Arquivo CSV nao encontrado: ${fileName}`);
}

function readCsvRows(filePath: string): CsvRow[] {
  const rawBuffer = fs.readFileSync(filePath);
  const utf8 = rawBuffer.toString("utf8");
  const rawContent = utf8.includes("\uFFFD") ? rawBuffer.toString("latin1") : utf8;

  return parse(rawContent, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
    relax_column_count: true,
    bom: true,
  }) as CsvRow[];
}

function parseDocumentsRows(rows: CsvRow[], supplierInputs: Map<string, SupplierInput>): {
  documents: DocumentInput[];
  skippedDocuments: number;
} {
  const documents: DocumentInput[] = [];
  const seenKeys = new Set<string>();
  let skippedDocuments = 0;

  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index]!;

    const supplierCode = findColumnValue(row, "CODCLI");
    const dueDateRaw = findColumnValue(row, "DTVENC");
    const amountRaw = findColumnValue(row, "VALOR");

    if (!supplierCode || !dueDateRaw || !amountRaw) {
      skippedDocuments += 1;
      continue;
    }

    const dueDate = parsePtBrDate(dueDateRaw);
    const amount = parseNumberPtBr(amountRaw);

    if (!dueDate || amount === null) {
      skippedDocuments += 1;
      continue;
    }

    const duplicateNumber = findColumnValue(row, "DUPLIC");
    const installment = parseInteger(findColumnValue(row, "PREST"));
    const issueDate = parsePtBrDate(findColumnValue(row, "DTEMISSAO"));
    const paidAt = parsePtBrDate(findColumnValue(row, "DTPAG"));
    const operationType = findColumnValue(row, "OPERACAO");
    const boletoLine = normalizeDigits(findColumnValue(row, "LINHADIG"));
    const barcode = normalizeDigits(findColumnValue(row, "CODBARRA"));
    const ourNumber = findColumnValue(row, "NOSSONUMBCO");
    const rowSequence = findBlankColumnValue(row) ?? String(index + 1);

    let externalKey = buildExternalKey({
      supplierCode,
      duplicateNumber,
      installment,
      dueDateRaw,
      amountRaw,
      ourNumber,
      barcode,
      boletoLine,
      rowSequence,
    });

    if (seenKeys.has(externalKey)) {
      externalKey = `${externalKey}:${rowSequence}`;
    }
    seenKeys.add(externalKey);

    const description = buildDescription({
      duplicateNumber,
      installment,
      operationType,
      dueDate,
    });

    documents.push({
      supplierCode,
      externalKey,
      description,
      duplicateNumber,
      installment,
      amount,
      dueDate,
      issueDate,
      paidAt,
      status: toBillingStatus(dueDate, paidAt),
      operationType,
      boletoLine,
      barcode,
      ourNumber,
    });

    if (!supplierInputs.has(supplierCode)) {
      supplierInputs.set(supplierCode, {
        externalCode: supplierCode,
        name: `Cliente ${supplierCode}`,
        city: null,
        document: null,
      });
    }
  }

  return { documents, skippedDocuments };
}

function parseSuppliersRows(rows: CsvRow[]): Map<string, SupplierInput> {
  const suppliers = new Map<string, SupplierInput>();

  for (const row of rows) {
    const externalCode = findColumnValue(row, "CODCLI");
    if (!externalCode) {
      continue;
    }

    const name = findColumnValue(row, "CLIENTE") ?? `Cliente ${externalCode}`;
    const city = findColumnValue(row, "MUNICCOB");
    const document = extractDocumentFromSupplierName(name);

    suppliers.set(externalCode, {
      externalCode,
      name,
      city,
      document,
    });
  }

  return suppliers;
}

export async function importBillingCsvForCompany(
  prisma: PrismaClient,
  companyId: string,
  options: CsvImportOptions = {},
): Promise<BillingCsvImportResult> {
  const fornecedoresPath = resolveCsvFilePath(DEFAULT_SUPPLIERS_FILE, options.fornecedoresPath);
  const documentosPath = resolveCsvFilePath(DEFAULT_DOCUMENTS_FILE, options.documentosPath);

  const supplierRows = readCsvRows(fornecedoresPath);
  const documentRows = readCsvRows(documentosPath);

  const supplierInputs = parseSuppliersRows(supplierRows);
  const { documents, skippedDocuments } = parseDocumentsRows(documentRows, supplierInputs);

  const supplierCodes = Array.from(supplierInputs.keys());
  const existingSuppliers = supplierCodes.length
    ? await prisma.billingSupplier.findMany({
        where: {
          companyId,
          externalCode: {
            in: supplierCodes,
          },
        },
        select: {
          id: true,
          externalCode: true,
        },
      })
    : [];

  const existingSuppliersByCode = new Map(existingSuppliers.map((supplier) => [supplier.externalCode, supplier]));
  const supplierIdByCode = new Map<string, string>();

  let suppliersCreated = 0;
  let suppliersUpdated = 0;

  for (const input of supplierInputs.values()) {
    const existing = existingSuppliersByCode.get(input.externalCode);

    if (existing) {
      const updated = await prisma.billingSupplier.update({
        where: { id: existing.id },
        data: {
          name: input.name,
          city: input.city,
          document: input.document,
        },
        select: { id: true },
      });

      suppliersUpdated += 1;
      supplierIdByCode.set(input.externalCode, updated.id);
      continue;
    }

    const created = await prisma.billingSupplier.create({
      data: {
        companyId,
        externalCode: input.externalCode,
        name: input.name,
        city: input.city,
        document: input.document,
      },
      select: { id: true },
    });

    suppliersCreated += 1;
    supplierIdByCode.set(input.externalCode, created.id);
  }

  let documentsCreated = 0;
  let documentsUpdated = 0;

  const previousDocumentsCount = await prisma.billingDocument.count({
    where: { companyId },
  });

  if (previousDocumentsCount > 0) {
    await prisma.billingDocument.deleteMany({
      where: { companyId },
    });
    documentsUpdated = previousDocumentsCount;
  }

  for (const document of documents) {
    const supplierId = supplierIdByCode.get(document.supplierCode);
    if (!supplierId) {
      continue;
    }

    const payload = {
      supplierId,
      description: document.description,
      duplicateNumber: document.duplicateNumber,
      installment: document.installment,
      amount: document.amount,
      dueDate: document.dueDate,
      issueDate: document.issueDate,
      paidAt: document.paidAt,
      status: document.status,
      operationType: document.operationType,
      boletoLine: document.boletoLine,
      barcode: document.barcode,
      ourNumber: document.ourNumber,
    };

    await prisma.billingDocument.create({
      data: {
        companyId,
        externalKey: document.externalKey,
        ...payload,
      },
    });

    documentsCreated += 1;
  }

  const [suppliersTotal, documentsTotal] = await Promise.all([
    prisma.billingSupplier.count({ where: { companyId } }),
    prisma.billingDocument.count({ where: { companyId } }),
  ]);

  return {
    suppliersCreated,
    suppliersUpdated,
    documentsCreated,
    documentsUpdated,
    suppliersTotal,
    documentsTotal,
    skippedDocuments,
    fornecedoresPath,
    documentosPath,
  };
}
