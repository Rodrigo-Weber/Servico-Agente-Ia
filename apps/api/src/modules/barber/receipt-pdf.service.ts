import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

export interface BookingReceiptPdfInput {
  receiptId: string;
  companyName: string;
  companyDocument: string | null;
  clientName: string;
  clientDocument: string | null;
  serviceName: string;
  serviceValue: number;
  appointmentDate: Date;
  resourceName: string | null;
}

function formatMoney(value: number): string {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
  }).format(value);
}

function formatDateTime(value: Date): string {
  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(value);
}

function normalizeText(value: string | null | undefined): string {
  const text = (value || "").replace(/\s+/g, " ").trim();
  return text.length > 0 ? text : "-";
}

export async function generateBookingReceiptPdf(input: BookingReceiptPdfInput): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([595.28, 841.89]); // A4
  const fontRegular = await pdf.embedFont(StandardFonts.Helvetica);
  const fontBold = await pdf.embedFont(StandardFonts.HelveticaBold);

  const marginX = 42;
  const pageTop = page.getHeight() - 48;
  const textColor = rgb(0.08, 0.08, 0.08);
  const muted = rgb(0.35, 0.35, 0.4);
  const border = rgb(0.83, 0.85, 0.88);
  const bg = rgb(0.96, 0.97, 0.98);

  page.drawRectangle({
    x: marginX,
    y: pageTop - 62,
    width: page.getWidth() - marginX * 2,
    height: 56,
    color: bg,
    borderColor: border,
    borderWidth: 1,
  });

  page.drawText("RECIBO DE SERVICO", {
    x: marginX + 12,
    y: pageTop - 30,
    size: 20,
    font: fontBold,
    color: textColor,
  });

  page.drawText(`Recibo: ${normalizeText(input.receiptId)}`, {
    x: marginX + 12,
    y: pageTop - 49,
    size: 10,
    font: fontRegular,
    color: muted,
  });

  const lines = [
    ["Empresa", normalizeText(input.companyName)],
    ["CNPJ", normalizeText(input.companyDocument)],
    ["Cliente", normalizeText(input.clientName)],
    ["Documento do cliente", normalizeText(input.clientDocument)],
    ["Servico", normalizeText(input.serviceName)],
    ["Recurso", normalizeText(input.resourceName)],
    ["Data do atendimento", formatDateTime(input.appointmentDate)],
    ["Valor", formatMoney(input.serviceValue)],
  ] as const;

  let y = pageTop - 100;
  for (const [label, value] of lines) {
    page.drawText(`${label}:`, {
      x: marginX,
      y,
      size: 11,
      font: fontBold,
      color: textColor,
    });

    page.drawText(value, {
      x: marginX + 150,
      y,
      size: 11,
      font: fontRegular,
      color: textColor,
    });

    y -= 24;
  }

  y -= 20;
  page.drawLine({
    start: { x: marginX, y },
    end: { x: page.getWidth() - marginX, y },
    thickness: 1,
    color: border,
  });

  y -= 22;
  page.drawText("Documento gerado automaticamente pelo sistema de atendimento.", {
    x: marginX,
    y,
    size: 9,
    font: fontRegular,
    color: muted,
  });

  y -= 14;
  page.drawText(`Emitido em ${formatDateTime(new Date())}.`, {
    x: marginX,
    y,
    size: 9,
    font: fontRegular,
    color: muted,
  });

  return pdf.save();
}
