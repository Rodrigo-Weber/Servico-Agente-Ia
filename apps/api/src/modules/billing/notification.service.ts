import { Prisma } from "@prisma/client";
import * as boletoUtils from "@mrmgomes/boleto-utils";
import { prisma } from "../../lib/prisma.js";
import { evolutionService } from "../../services/evolution.service.js";
import { buildStoredMessageContent } from "../messages/message-content.js";
import { generateBillingBoletoPdf } from "./boleto-pdf.service.js";

export const BILLING_TEST_NOTIFICATION_PHONE = "5571983819052";

export const BILLING_ADVANCE_REMINDER_DAYS = [30, 15, 7] as const;

const BANK_NAMES_BY_CODE: Record<string, string> = {
  "001": "Banco do Brasil",
  "033": "Santander",
  "041": "Banrisul",
  "104": "Caixa Economica Federal",
  "237": "Bradesco",
  "341": "Itau",
  "756": "Sicoob",
};

interface BillingBoletoDataInput {
  boletoLine: string | null;
  barcode: string | null;
}

interface SendBillingDocumentNotificationInput {
  companyId: string;
  evolutionInstanceName: string | null;
  documentId: string;
  supplierName: string;
  description: string;
  amount: number;
  dueDate: Date;
  boletoLine: string | null;
  barcode: string | null;
  targetPhone: string;
  intent?: string | null;
  daysUntilDue?: number | null;
  setNotificationCount?: number;
}

function formatMoney(value: number): string {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
  }).format(value);
}

function formatDate(value: Date): string {
  return value.toLocaleDateString("pt-BR");
}

function digitsOnly(value: string | null | undefined): string {
  return (value || "").replace(/\D/g, "");
}

function normalizePersonName(value: string): string {
  const clean = value
    .trim()
    .replace(/\s+/g, " ")
    .replace(/[^\p{L}\p{N}\s]/gu, "");

  if (!clean) {
    return "Cliente";
  }

  return clean
    .split(" ")
    .filter(Boolean)
    .map((token) => token.charAt(0).toUpperCase() + token.slice(1).toLowerCase())
    .join(" ");
}

function truncateText(value: string, maxLength: number): string {
  if (value.length <= maxLength) {
    return value;
  }

  const safeMax = Math.max(0, maxLength - 3);
  return `${value.slice(0, safeMax).trim()}...`;
}

function formatLinhaDigitavel(value: string): string {
  const digits = digitsOnly(value);

  if (digits.length === 47) {
    return `${digits.slice(0, 5)}.${digits.slice(5, 10)} ${digits.slice(10, 15)}.${digits.slice(15, 21)} ${digits.slice(21, 26)}.${digits.slice(26, 32)} ${digits.slice(32, 33)} ${digits.slice(33)}`;
  }

  if (digits.length === 48) {
    return `${digits.slice(0, 11)}-${digits.slice(11, 12)} ${digits.slice(12, 23)}-${digits.slice(23, 24)} ${digits.slice(24, 35)}-${digits.slice(35, 36)} ${digits.slice(36, 47)}-${digits.slice(47, 48)}`;
  }

  return value;
}

function safeValidateBoleto(code: string): {
  linhaDigitavel?: string;
  codigoBarras?: string;
  sucesso?: boolean;
} | null {
  try {
    const result = boletoUtils.validarBoleto(code) as {
      linhaDigitavel?: string;
      codigoBarras?: string;
      sucesso?: boolean;
    };

    return result?.sucesso ? result : null;
  } catch {
    return null;
  }
}

function resolveBoletoData(input: BillingBoletoDataInput): {
  linhaDigitavel: string | null;
  codigoBarras: string | null;
} {
  let line = digitsOnly(input.boletoLine);
  let barcode = digitsOnly(input.barcode);

  const validatedFromLine = line ? safeValidateBoleto(line) : null;
  const validated = validatedFromLine ?? (barcode ? safeValidateBoleto(barcode) : null);

  if (validated) {
    line = digitsOnly(validated.linhaDigitavel) || line;
    barcode = digitsOnly(validated.codigoBarras) || barcode;
  }

  if (!line && barcode.length === 44) {
    try {
      line = digitsOnly(boletoUtils.codBarras2LinhaDigitavel(barcode, false));
    } catch {
      // fallback para manter apenas codigo de barras
    }
  }

  if (!barcode && line.length >= 46) {
    try {
      barcode = digitsOnly(boletoUtils.linhaDigitavel2CodBarras(line));
    } catch {
      // fallback para manter apenas linha digitavel
    }
  }

  return {
    linhaDigitavel: line ? formatLinhaDigitavel(line) : null,
    codigoBarras: barcode || null,
  };
}

function resolveBankFromBoleto(input: { linhaDigitavel: string | null; codigoBarras: string | null }): {
  code: string | null;
  name: string | null;
} {
  const lineDigits = digitsOnly(input.linhaDigitavel);
  const barcodeDigits = digitsOnly(input.codigoBarras);

  let code: string | null = null;
  if (lineDigits.length >= 3) {
    code = lineDigits.slice(0, 3);
  } else if (barcodeDigits.length === 44) {
    code = barcodeDigits.slice(0, 3);
  }

  if (!code) {
    return { code: null, name: null };
  }

  return {
    code,
    name: BANK_NAMES_BY_CODE[code] ?? `Banco ${code}`,
  };
}

function buildNotificationMessage(input: {
  supplierName: string;
  description: string;
  amount: number;
  dueDate: Date;
  linhaDigitavel: string | null;
  codigoBarras: string | null;
  daysUntilDue?: number | null;
}): string {
  const customerName = normalizePersonName(input.supplierName);
  const firstName = customerName.split(/\s+/)[0] || "Cliente";
  const bank = resolveBankFromBoleto({
    linhaDigitavel: input.linhaDigitavel,
    codigoBarras: input.codigoBarras,
  });
  const reference = truncateText(input.description, 90);

  const lines = [
    "📌 *AVISO DE COBRANCA*",
    "",
    `Olá, *${firstName}*.`,
    "",
    "Segue o boleto em PDF com os dados para pagamento:",
    `• *Referência:* ${reference}`,
    `• *Valor:* ${formatMoney(input.amount)}`,
    `• *Vencimento:* ${formatDate(input.dueDate)}`,
  ];

  if (typeof input.daysUntilDue === "number" && input.daysUntilDue > 0) {
    lines.push(`• *Lembrete:* faltam ${input.daysUntilDue} dia(s) para o vencimento`);
  }

  if (bank.name) {
    lines.push(`• *Banco:* ${bank.name}${bank.code ? ` (${bank.code})` : ""}`);
  }

  if (input.linhaDigitavel) {
    lines.push(`• *Linha digitavel:* \`${input.linhaDigitavel}\``);
  }

  if (input.codigoBarras) {
    lines.push(`• *Codigo de barras:* \`${input.codigoBarras}\``);
  }

  lines.push("");
  lines.push("📎 *Boleto anexado nesta conversa.*");
  lines.push("Se o pagamento ja foi realizado, desconsidere esta mensagem.");
  lines.push("Em caso de duvida, responda este WhatsApp.");
  lines.push("");
  lines.push("*Departamento Financeiro*");

  return lines.join("\n");
}

export async function sendBillingDocumentNotification(input: SendBillingDocumentNotificationInput): Promise<{
  message: string;
  phone: string;
  mediaType: "application/pdf";
}> {
  const boletoData = resolveBoletoData({
    boletoLine: input.boletoLine,
    barcode: input.barcode,
  });

  const message = buildNotificationMessage({
    supplierName: input.supplierName,
    description: input.description,
    amount: input.amount,
    dueDate: input.dueDate,
    linhaDigitavel: boletoData.linhaDigitavel,
    codigoBarras: boletoData.codigoBarras,
    daysUntilDue: input.daysUntilDue ?? null,
  });

  const dueDateTag = [
    input.dueDate.getFullYear(),
    String(input.dueDate.getMonth() + 1).padStart(2, "0"),
    String(input.dueDate.getDate()).padStart(2, "0"),
  ].join("");
  const fileName = `boleto-${input.documentId}-${dueDateTag}.pdf`;

  const boletoPdf = await generateBillingBoletoPdf({
    documentId: input.documentId,
    supplierName: input.supplierName,
    description: input.description,
    amount: input.amount,
    dueDate: input.dueDate,
    linhaDigitavel: boletoData.linhaDigitavel,
    codigoBarras: boletoData.codigoBarras,
  });
  const boletoPdfBase64 = Buffer.from(boletoPdf).toString("base64");

  const outLog = await prisma.messageLog.create({
    data: {
      companyId: input.companyId,
      phoneE164: input.targetPhone,
      direction: "out",
      messageType: "media",
      intent: input.intent ?? "billing_notify",
      content: buildStoredMessageContent({
        text: message,
        attachment: {
          fileName,
          mimeType: "application/pdf",
          mediaType: "document",
          base64: boletoPdfBase64,
        },
      }),
      status: "received",
    },
    select: {
      id: true,
    },
  });

  try {
    await evolutionService.sendDocument(
      input.targetPhone,
      {
        base64: boletoPdfBase64,
        fileName,
        mimeType: "application/pdf",
        caption: message,
      },
      input.evolutionInstanceName ?? undefined,
    );

    await prisma.messageLog.update({
      where: { id: outLog.id },
      data: { status: "processed" },
    });
  } catch (error) {
    await prisma.messageLog.update({
      where: { id: outLog.id },
      data: { status: "failed" },
    });

    const errMessage = error instanceof Error ? error.message : "Falha ao enviar boleto em PDF";
    throw new Error(errMessage);
  }

  const updateData: Prisma.BillingDocumentUpdateInput = {
    notificationLastAt: new Date(),
  };

  if (typeof input.setNotificationCount === "number") {
    updateData.notificationCount = Math.max(0, Math.trunc(input.setNotificationCount));
  } else {
    updateData.notificationCount = {
      increment: 1,
    };
  }

  await prisma.billingDocument.update({
    where: { id: input.documentId },
    data: updateData,
  });

  return {
    message,
    phone: input.targetPhone,
    mediaType: "application/pdf",
  };
}
