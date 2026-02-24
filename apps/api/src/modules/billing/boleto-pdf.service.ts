import bwipjs from "bwip-js";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

export interface BillingBoletoPdfInput {
  documentId: string;
  supplierName: string;
  description: string;
  amount: number;
  dueDate: Date;
  linhaDigitavel: string | null;
  codigoBarras: string | null;
}

const BANK_NAMES_BY_CODE: Record<string, string> = {
  "001": "Banco do Brasil",
  "033": "Santander",
  "041": "Banrisul",
  "104": "Caixa Economica Federal",
  "237": "Bradesco",
  "341": "Itau",
  "756": "Sicoob",
};

function formatMoney(value: number): string {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
  }).format(value);
}

function formatDate(value: Date): string {
  return value.toLocaleDateString("pt-BR");
}

function cleanDigits(value: string | null): string {
  return (value || "").replace(/\D/g, "");
}

function normalizeText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function splitLongToken(token: string, getWidth: (value: string) => number, maxWidth: number): string[] {
  if (!token) {
    return [];
  }

  const chunks: string[] = [];
  let current = "";

  for (const char of token) {
    const next = `${current}${char}`;
    if (getWidth(next) <= maxWidth || current.length === 0) {
      current = next;
    } else {
      chunks.push(current);
      current = char;
    }
  }

  if (current) {
    chunks.push(current);
  }

  return chunks;
}

function wrapTextByWidth(input: {
  text: string;
  getWidth: (value: string) => number;
  maxWidth: number;
}): string[] {
  const normalized = normalizeText(input.text);
  if (!normalized) {
    return ["-"];
  }

  const lines: string[] = [];
  let current = "";

  const words = normalized.split(" ");
  for (const word of words) {
    const token = word.trim();
    if (!token) {
      continue;
    }

    if (!current) {
      if (input.getWidth(token) <= input.maxWidth) {
        current = token;
      } else {
        const pieces = splitLongToken(token, input.getWidth, input.maxWidth);
        if (pieces.length > 0) {
          current = pieces.pop() as string;
          lines.push(...pieces);
        }
      }
      continue;
    }

    const candidate = `${current} ${token}`;
    if (input.getWidth(candidate) <= input.maxWidth) {
      current = candidate;
      continue;
    }

    lines.push(current);

    if (input.getWidth(token) <= input.maxWidth) {
      current = token;
      continue;
    }

    const pieces = splitLongToken(token, input.getWidth, input.maxWidth);
    if (pieces.length > 0) {
      current = pieces.pop() as string;
      lines.push(...pieces);
    } else {
      current = token;
    }
  }

  if (current) {
    lines.push(current);
  }

  return lines.length > 0 ? lines : ["-"];
}

function resolveBankInfo(input: { linhaDigitavel: string | null; codigoBarras: string | null }): {
  code: string | null;
  name: string;
} {
  const lineDigits = cleanDigits(input.linhaDigitavel);
  const barcodeDigits = cleanDigits(input.codigoBarras);

  const code = lineDigits.length >= 3 ? lineDigits.slice(0, 3) : barcodeDigits.length === 44 ? barcodeDigits.slice(0, 3) : null;
  if (!code) {
    return {
      code: null,
      name: "Banco emissor",
    };
  }

  return {
    code,
    name: BANK_NAMES_BY_CODE[code] ?? `Banco ${code}`,
  };
}

async function generateBarcodePng(codigoBarras: string): Promise<Buffer | null> {
  const digits = cleanDigits(codigoBarras);
  if (digits.length !== 44) {
    return null;
  }

  try {
    const png = await bwipjs.toBuffer({
      bcid: "interleaved2of5",
      text: digits,
      scale: 3,
      height: 12,
      includetext: false,
      backgroundcolor: "FFFFFF",
    });

    return png;
  } catch {
    return null;
  }
}

export async function generateBillingBoletoPdf(input: BillingBoletoPdfInput): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([595.28, 841.89]); // A4 portrait

  const fontRegular = await pdf.embedFont(StandardFonts.Helvetica);
  const fontBold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const fontMono = await pdf.embedFont(StandardFonts.Courier);

  const margin = 28;
  const pageWidth = page.getWidth();
  const contentWidth = pageWidth - margin * 2;
  const textColor = rgb(0.08, 0.08, 0.1);
  const mutedTextColor = rgb(0.36, 0.36, 0.4);
  const borderColor = rgb(0.72, 0.74, 0.78);
  const subtleBackground = rgb(0.95, 0.96, 0.98);
  const line = input.linhaDigitavel || "Nao informado";
  const barcodeDigits = cleanDigits(input.codigoBarras);
  const bank = resolveBankInfo({
    linhaDigitavel: input.linhaDigitavel,
    codigoBarras: input.codigoBarras,
  });
  const reference = normalizeText(input.description) || "Sem referencia";
  const documentNumber = normalizeText(input.documentId.toUpperCase()) || "-";

  let y = page.getHeight() - margin;

  const drawCell = (cell: {
    x: number;
    yTop: number;
    width: number;
    height: number;
    label: string;
    value: string;
    mono?: boolean;
    valueSize?: number;
    alignRight?: boolean;
    multiline?: boolean;
    minValueSize?: number;
  }) => {
    page.drawRectangle({
      x: cell.x,
      y: cell.yTop - cell.height,
      width: cell.width,
      height: cell.height,
      borderColor,
      borderWidth: 0.8,
      color: rgb(1, 1, 1),
    });

    page.drawText(cell.label, {
      x: cell.x + 5,
      y: cell.yTop - 11,
      size: 7.5,
      font: fontRegular,
      color: mutedTextColor,
    });

    const valueFont = cell.mono ? fontMono : fontBold;
    const minSize = cell.minValueSize ?? 6.8;
    let valueSize = cell.valueSize ?? 10;

    if (cell.multiline) {
      const valueAreaWidth = Math.max(12, cell.width - 10);
      const valueAreaHeight = Math.max(8, cell.height - 20);
      let lineHeight = valueSize + 1.3;
      let lines = wrapTextByWidth({
        text: cell.value,
        getWidth: (value) => valueFont.widthOfTextAtSize(value, valueSize),
        maxWidth: valueAreaWidth,
      });

      while (valueSize > minSize && lines.length * lineHeight > valueAreaHeight) {
        valueSize -= 0.3;
        lineHeight = valueSize + 1.2;
        lines = wrapTextByWidth({
          text: cell.value,
          getWidth: (value) => valueFont.widthOfTextAtSize(value, valueSize),
          maxWidth: valueAreaWidth,
        });
      }

      let currentY = cell.yTop - 21;
      for (const row of lines) {
        page.drawText(row, {
          x: cell.x + 5,
          y: currentY,
          size: valueSize,
          font: valueFont,
          color: textColor,
        });
        currentY -= lineHeight;
      }

      return;
    }

    const textWidth = valueFont.widthOfTextAtSize(cell.value, valueSize);
    const valueX = cell.alignRight ? Math.max(cell.x + 5, cell.x + cell.width - textWidth - 5) : cell.x + 5;

    page.drawText(cell.value, {
      x: valueX,
      y: cell.yTop - cell.height + 8,
      size: valueSize,
      font: valueFont,
      color: textColor,
    });
  };

  // Header (recibo do pagador)
  page.drawRectangle({
    x: margin,
    y: y - 28,
    width: contentWidth,
    height: 24,
    borderColor,
    borderWidth: 0.9,
    color: subtleBackground,
  });

  page.drawText("RECIBO DO PAGADOR", {
    x: margin + 8,
    y: y - 18,
    size: 9,
    font: fontBold,
    color: textColor,
  });

  page.drawText(bank.code ? `${bank.name} (${bank.code})` : bank.name, {
    x: margin + 145,
    y: y - 18,
    size: 10,
    font: fontBold,
    color: textColor,
  });

  page.drawText("BOLETO BANCARIO", {
    x: margin + contentWidth - 124,
    y: y - 18,
    size: 9,
    font: fontBold,
    color: textColor,
  });

  y -= 36;

  const rightColumnWidth = 165;
  const leftColumnWidth = contentWidth - rightColumnWidth;

  drawCell({
    x: margin,
    yTop: y,
    width: leftColumnWidth,
    height: 34,
    label: "Local de pagamento",
    value: "Pagavel em qualquer banco ate o vencimento",
    valueSize: 9.2,
  });

  drawCell({
    x: margin + leftColumnWidth,
    yTop: y,
    width: rightColumnWidth,
    height: 34,
    label: "Vencimento",
    value: formatDate(input.dueDate),
    alignRight: true,
    valueSize: 11,
  });

  y -= 34;

  drawCell({
    x: margin,
    yTop: y,
    width: leftColumnWidth,
    height: 34,
    label: "Beneficiario",
    value: "Departamento Financeiro",
    valueSize: 9.8,
  });

  drawCell({
    x: margin + leftColumnWidth,
    yTop: y,
    width: rightColumnWidth,
    height: 34,
    label: "Valor do documento",
    value: formatMoney(input.amount),
    alignRight: true,
    valueSize: 11,
  });

  y -= 34;

  const line1W = 126;
  const line2W = 142;
  const line3W = leftColumnWidth - line1W - line2W;
  const row3Height = 44;

  drawCell({
    x: margin,
    yTop: y,
    width: line1W,
    height: row3Height,
    label: "Data do documento",
    value: formatDate(new Date()),
    valueSize: 9.5,
  });

  drawCell({
    x: margin + line1W,
    yTop: y,
    width: line2W,
    height: row3Height,
    label: "Numero do documento",
    value: documentNumber,
    valueSize: 8.8,
    multiline: true,
    minValueSize: 6.5,
  });

  drawCell({
    x: margin + line1W + line2W,
    yTop: y,
    width: line3W,
    height: row3Height,
    label: "Referencia",
    value: reference,
    valueSize: 8.4,
    multiline: true,
    minValueSize: 6.4,
  });

  drawCell({
    x: margin + leftColumnWidth,
    yTop: y,
    width: rightColumnWidth,
    height: row3Height,
    label: "Pagador",
    value: normalizeText(input.supplierName) || "-",
    valueSize: 8.7,
    multiline: true,
    minValueSize: 6.5,
  });

  y -= row3Height;

  page.drawRectangle({
    x: margin,
    y: y - 42,
    width: contentWidth,
    height: 42,
    borderColor,
    borderWidth: 0.8,
    color: rgb(1, 1, 1),
  });

  page.drawText("Linha digitavel", {
    x: margin + 5,
    y: y - 10,
    size: 7.5,
    font: fontRegular,
    color: mutedTextColor,
  });

  page.drawText(line, {
    x: margin + 5,
    y: y - 28,
    size: 11,
    font: fontMono,
    color: textColor,
  });

  y -= 56;

  drawCell({
    x: margin,
    yTop: y,
    width: contentWidth,
    height: 52,
    label: "Instrucoes",
    value: "Apos o vencimento, consulte o emissor para atualizacao. Documento valido para pagamento no banco indicado.",
    valueSize: 8.7,
  });

  y -= 64;

  // Divider (canhoto)
  for (let x = margin; x < margin + contentWidth; x += 8) {
    page.drawLine({
      start: { x, y },
      end: { x: x + 4, y },
      color: rgb(0.62, 0.62, 0.66),
      thickness: 0.7,
    });
  }

  y -= 14;

  page.drawText("FICHA DE COMPENSACAO", {
    x: margin + 4,
    y: y - 2,
    size: 9,
    font: fontBold,
    color: textColor,
  });

  page.drawText(bank.code ? `${bank.name} (${bank.code})` : bank.name, {
    x: margin + 185,
    y: y - 2,
    size: 9,
    font: fontBold,
    color: textColor,
  });

  page.drawText("Autenticacao mecanica", {
    x: margin + contentWidth - 115,
    y: y - 2,
    size: 7.5,
    font: fontRegular,
    color: mutedTextColor,
  });

  y -= 12;

  const compRow1Height = 42;

  drawCell({
    x: margin,
    yTop: y,
    width: contentWidth - rightColumnWidth,
    height: compRow1Height,
    label: "Pagador",
    value: normalizeText(input.supplierName) || "-",
    valueSize: 9.5,
    multiline: true,
    minValueSize: 6.8,
  });

  drawCell({
    x: margin + (contentWidth - rightColumnWidth),
    yTop: y,
    width: rightColumnWidth,
    height: compRow1Height,
    label: "Valor do documento",
    value: formatMoney(input.amount),
    alignRight: true,
    valueSize: 11,
  });

  y -= compRow1Height;

  const compRow2Height = 42;

  drawCell({
    x: margin,
    yTop: y,
    width: contentWidth - rightColumnWidth,
    height: compRow2Height,
    label: "Referencia",
    value: reference,
    valueSize: 8.8,
    multiline: true,
    minValueSize: 6.6,
  });

  drawCell({
    x: margin + (contentWidth - rightColumnWidth),
    yTop: y,
    width: rightColumnWidth,
    height: compRow2Height,
    label: "Vencimento",
    value: formatDate(input.dueDate),
    alignRight: true,
    valueSize: 11,
  });

  y -= compRow2Height + 8;

  page.drawRectangle({
    x: margin,
    y: y - 34,
    width: contentWidth,
    height: 34,
    borderColor,
    borderWidth: 0.8,
    color: rgb(1, 1, 1),
  });

  page.drawText("Linha digitavel", {
    x: margin + 5,
    y: y - 10,
    size: 7.5,
    font: fontRegular,
    color: mutedTextColor,
  });

  page.drawText(line, {
    x: margin + 5,
    y: y - 24,
    size: 11,
    font: fontMono,
    color: textColor,
  });

  y -= 52;

  if (barcodeDigits.length === 44) {
    const barcodePng = await generateBarcodePng(barcodeDigits);
    if (barcodePng) {
      const barcodeImage = await pdf.embedPng(barcodePng);
      page.drawRectangle({
        x: margin,
        y: y - 90,
        width: contentWidth,
        height: 90,
        borderColor,
        borderWidth: 0.8,
        color: rgb(1, 1, 1),
      });

      page.drawImage(barcodeImage, {
        x: margin + 6,
        y: y - 76,
        width: contentWidth - 12,
        height: 56,
      });

      page.drawText(barcodeDigits, {
        x: margin + 8,
        y: y - 86,
        size: 8.8,
        font: fontMono,
        color: textColor,
      });

      y -= 100;
    } else {
      drawCell({
        x: margin,
        yTop: y,
        width: contentWidth,
        height: 34,
        label: "Codigo de barras",
        value: barcodeDigits,
        mono: true,
        valueSize: 9.2,
      });
      y -= 40;
    }
  }

  page.drawText(`Documento: ${documentNumber}`, {
    x: margin,
    y,
    size: 8,
    font: fontRegular,
    color: mutedTextColor,
  });

  y -= 12;

  page.drawText(`Gerado em ${new Date().toLocaleString("pt-BR")}`, {
    x: margin,
    y,
    size: 8,
    font: fontRegular,
    color: mutedTextColor,
  });

  return pdf.save();
}
