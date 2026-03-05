/**
 * NFS-e Service — Emissão de NFS-e gratuita direto via SEFAZ municipal
 * usando certificado digital A1 (padrão ABRASF 2.04).
 *
 * Fluxo: Config + Certificado A1 → Construir XML → Assinar → SOAP → NFS-e autorizada
 */

import { prisma } from "../lib/prisma.js";
import { sefazNfseService } from "./nfse-sefaz.service.js";
import type { NfseStatus } from "@prisma/client";

/* ─── Tipos ─── */

export interface NfseTomador {
  nome: string;
  cpfCnpj?: string | null;
  email?: string | null;
  telefone?: string | null;
  logradouro?: string;
  numero?: string;
  bairro?: string;
  codigoMunicipio?: string;
  uf?: string;
  cep?: string;
}

export interface NfseEmissaoInput {
  companyId: string;
  appointmentId?: string;
  valorServicos: number;
  discriminacao: string;
  tomador: NfseTomador;
}

/* ─── Helpers ─── */

function onlyDigits(value: string | null | undefined): string {
  return (value || "").replace(/\D/g, "");
}

/* ─── Service ─── */

export class NfseService {
  /**
   * Busca a configuração NFS-e da empresa
   */
  async getConfig(companyId: string) {
    return prisma.nfseConfig.findUnique({ where: { companyId } });
  }

  /**
   * Salva/atualiza configuração NFS-e
   */
  async upsertConfig(
    companyId: string,
    data: {
      provider?: string;
      apiToken?: string;
      environment?: string;
      inscricaoMunicipal?: string;
      codigoMunicipio?: string;
      regimeTributario?: number;
      itemListaServico?: string;
      codigoTributarioMunicipio?: string;
      aliquotaIss?: number;
      issRetido?: boolean;
      naturezaOperacao?: number;
      descricaoPadrao?: string;
      autoEmitir?: boolean;
      enviarWhatsapp?: boolean;
      sefazEndpoint?: string;
      serieRps?: string;
    }
  ) {
    return prisma.nfseConfig.upsert({
      where: { companyId },
      create: { companyId, ...data },
      update: data,
    });
  }

  /**
   * Valida que a empresa tem certificado A1 e config NFS-e prontos
   */
  private async validatePrerequisites(companyId: string) {
    const config = await this.getConfig(companyId);
    if (!config) {
      throw new Error(
        "NFS-e não configurada. Acesse Configurações > NFS-e e preencha os dados fiscais."
      );
    }

    if (!config.sefazEndpoint) {
      throw new Error(
        "Endpoint SEFAZ não configurado. Informe a URL do WebService NFS-e do seu município."
      );
    }

    if (!config.inscricaoMunicipal) {
      throw new Error("Inscrição Municipal não configurada.");
    }

    if (!config.codigoMunicipio) {
      throw new Error("Código do Município não configurado.");
    }

    // Valida certificado A1
    const certData = await sefazNfseService.loadCertificate(companyId);

    const company = await prisma.company.findUniqueOrThrow({
      where: { id: companyId },
    });

    return { config, certData, company };
  }

  /**
   * Emite uma NFS-e via SEFAZ municipal usando certificado A1
   */
  async emitir(input: NfseEmissaoInput): Promise<{
    nfseDocId: string;
    status: NfseStatus;
    providerRef: string | null;
    errorMessage: string | null;
  }> {
    const { config, certData, company } = await this.validatePrerequisites(
      input.companyId
    );

    // Incrementa número do RPS atomicamente
    const updatedConfig = await prisma.nfseConfig.update({
      where: { companyId: input.companyId },
      data: { ultimoNumeroRps: { increment: 1 } },
    });
    const rpsNumero = updatedConfig.ultimoNumeroRps;
    const rpsRef = `RPS-${rpsNumero}`;
    const numeroLote = rpsNumero; // Usa mesmo número para lote

    const aliquotaIss = config.aliquotaIss
      ? Number(config.aliquotaIss)
      : 0.05;

    // Salva o documento no banco ANTES de enviar
    const nfseDoc = await prisma.nfseServiceDocument.create({
      data: {
        companyId: input.companyId,
        appointmentId: input.appointmentId || null,
        providerRef: rpsRef,
        status: "processing",
        valorServicos: input.valorServicos,
        aliquotaIss: aliquotaIss,
        valorIss: Number((input.valorServicos * aliquotaIss).toFixed(2)),
        discriminacao: input.discriminacao,
        tomadorNome: input.tomador.nome,
        tomadorDocumento: input.tomador.cpfCnpj || null,
        tomadorEmail: input.tomador.email || null,
        tomadorTelefone: input.tomador.telefone || null,
        providerPayload: {
          metodo: "sefaz_direto",
          rpsNumero,
          rpsSerie: config.serieRps || "RPS",
          endpoint: config.sefazEndpoint,
        },
      },
    });

    try {
      const now = new Date();
      const dataEmissao = now.toISOString().slice(0, 19);
      const competencia = now.toISOString().slice(0, 10);

      // Emite via SEFAZ
      const result = await sefazNfseService.emitir(
        config.sefazEndpoint!,
        certData,
        {
          numero: rpsNumero,
          serie: config.serieRps || "RPS",
          tipo: 1,
          dataEmissao,
          competencia,
          cnpjPrestador: onlyDigits(company.cnpj),
          inscricaoMunicipal: config.inscricaoMunicipal || "",
          codigoMunicipio: config.codigoMunicipio || "",
          valorServicos: input.valorServicos,
          aliquotaIss,
          issRetido: config.issRetido,
          itemListaServico: config.itemListaServico || "1401",
          codigoTributarioMunicipio:
            config.codigoTributarioMunicipio || "1401",
          discriminacao: input.discriminacao,
          optanteSimplesNacional: (config.regimeTributario || 1) === 1,
          naturezaOperacao: config.naturezaOperacao || 1,
          tomador: {
            cpfCnpj: input.tomador.cpfCnpj || undefined,
            razaoSocial: input.tomador.nome,
            email: input.tomador.email || undefined,
            telefone: input.tomador.telefone || undefined,
            endereco: input.tomador.logradouro
              ? {
                  logradouro: input.tomador.logradouro,
                  numero: input.tomador.numero || "S/N",
                  bairro: input.tomador.bairro || "",
                  codigoMunicipio:
                    input.tomador.codigoMunicipio ||
                    config.codigoMunicipio ||
                    "",
                  uf: input.tomador.uf || "BA",
                  cep: input.tomador.cep || "",
                }
              : undefined,
          },
        },
        numeroLote
      );

      if (result.success) {
        // NFS-e autorizada!
        await prisma.nfseServiceDocument.update({
          where: { id: nfseDoc.id },
          data: {
            status: "authorized",
            numero: result.numero || null,
            codigoVerificacao: result.codigoVerificacao || null,
            providerProtocol: result.protocolo || null,
            providerResponse: {
              sefaz: true,
              numero: result.numero,
              codigoVerificacao: result.codigoVerificacao,
              dataEmissao: result.dataEmissao,
            },
            emitidaEm: result.dataEmissao
              ? new Date(result.dataEmissao)
              : new Date(),
            errorMessage: null,
          },
        });

        return {
          nfseDocId: nfseDoc.id,
          status: "authorized",
          providerRef: rpsRef,
          errorMessage: null,
        };
      } else {
        // Erro na emissão
        const errorMsg = result.errors
          .map((e) => `${e.codigo}: ${e.mensagem}`)
          .join("; ");

        await prisma.nfseServiceDocument.update({
          where: { id: nfseDoc.id },
          data: {
            status: "error",
            errorMessage: errorMsg || "Erro desconhecido na emissão via SEFAZ",
            providerResponse: {
              sefaz: true,
              errors: result.errors,
              xmlResposta: result.xmlResposta?.slice(0, 5000),
            },
          },
        });

        return {
          nfseDocId: nfseDoc.id,
          status: "error" as NfseStatus,
          providerRef: rpsRef,
          errorMessage: errorMsg,
        };
      }
    } catch (err: any) {
      const errorMsg =
        err?.message || "Erro desconhecido na comunicação com SEFAZ";

      await prisma.nfseServiceDocument.update({
        where: { id: nfseDoc.id },
        data: {
          status: "error",
          errorMessage: errorMsg,
        },
      });

      return {
        nfseDocId: nfseDoc.id,
        status: "error" as NfseStatus,
        providerRef: rpsRef,
        errorMessage: errorMsg,
      };
    }
  }

  /**
   * Consulta o status de uma NFS-e (para SEFAZ síncrono, lê do banco)
   */
  async consultarStatus(nfseDocId: string): Promise<{
    status: NfseStatus;
    pdfUrl: string | null;
    numero: string | null;
  }> {
    const doc = await prisma.nfseServiceDocument.findUniqueOrThrow({
      where: { id: nfseDocId },
    });

    // Para SEFAZ direto, a emissão é síncrona — o status já está no banco
    // Mas podemos tentar consultar por RPS se ainda estiver processing
    if (doc.status === "processing" && doc.providerRef) {
      try {
        const config = await this.getConfig(doc.companyId);
        if (config?.sefazEndpoint && config.inscricaoMunicipal) {
          const certData = await sefazNfseService.loadCertificate(
            doc.companyId
          );
          const company = await prisma.company.findUniqueOrThrow({
            where: { id: doc.companyId },
          });

          // Extrai número do RPS do providerRef (format: "RPS-123")
          const rpsNumero = parseInt(
            doc.providerRef.replace("RPS-", ""),
            10
          );
          if (!isNaN(rpsNumero)) {
            const result = await sefazNfseService.consultarPorRps(
              config.sefazEndpoint,
              certData,
              rpsNumero,
              config.serieRps || "RPS",
              1,
              onlyDigits(company.cnpj),
              config.inscricaoMunicipal
            );

            if (result.success && result.numero) {
              await prisma.nfseServiceDocument.update({
                where: { id: nfseDocId },
                data: {
                  status: "authorized",
                  numero: result.numero,
                  codigoVerificacao: result.codigoVerificacao || null,
                  emitidaEm: result.dataEmissao
                    ? new Date(result.dataEmissao)
                    : new Date(),
                },
              });

              return {
                status: "authorized",
                pdfUrl: doc.pdfUrl,
                numero: result.numero,
              };
            }
          }
        }
      } catch {
        // Falha na consulta — retorna status atual do banco
      }
    }

    return {
      status: doc.status,
      pdfUrl: doc.pdfUrl,
      numero: doc.numero,
    };
  }

  /**
   * Gera PDF simples da NFS-e (DANFSE simplificado)
   */
  async downloadPdf(nfseDocId: string): Promise<Buffer | null> {
    const doc = await prisma.nfseServiceDocument.findUniqueOrThrow({
      where: { id: nfseDocId },
    });

    // Se já tem PDF em cache, retorna
    if (doc.pdfBase64) {
      return Buffer.from(doc.pdfBase64, "base64");
    }

    // Se tem URL de PDF, baixa
    if (doc.pdfUrl) {
      try {
        const { default: axios } = await import("axios");
        const response = await axios.get(doc.pdfUrl, {
          responseType: "arraybuffer",
          timeout: 15000,
        });
        const buffer = Buffer.from(response.data);
        await prisma.nfseServiceDocument.update({
          where: { id: nfseDocId },
          data: { pdfBase64: buffer.toString("base64") },
        });
        return buffer;
      } catch {
        return null;
      }
    }

    // Gera DANFSE simplificado usando pdf-lib
    if (doc.status === "authorized" && doc.numero) {
      try {
        const pdf = await this.gerarDanfsePdf(doc);
        if (pdf) {
          await prisma.nfseServiceDocument.update({
            where: { id: nfseDocId },
            data: { pdfBase64: pdf.toString("base64") },
          });
          return pdf;
        }
      } catch (err) {
        console.error("[NFS-e] Erro ao gerar DANFSE PDF:", err);
      }
    }

    return null;
  }

  /**
   * Gera PDF simplificado da NFS-e (DANFSE)
   */
  private async gerarDanfsePdf(doc: any): Promise<Buffer | null> {
    try {
      const { PDFDocument, rgb, StandardFonts } = await import("pdf-lib");

      const company = await prisma.company.findUnique({
        where: { id: doc.companyId },
      });

      const pdfDoc = await PDFDocument.create();
      const page = pdfDoc.addPage([595, 842]); // A4
      const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
      const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

      const width = page.getWidth();
      let y = 800;
      const leftMargin = 40;
      const contentWidth = width - 80;

      // Cores
      const titleColor = rgb(0.1, 0.1, 0.4);
      const textColor = rgb(0.15, 0.15, 0.15);
      const labelColor = rgb(0.4, 0.4, 0.4);
      const lineColor = rgb(0.8, 0.8, 0.8);

      // Função helper para desenhar texto
      const drawText = (
        text: string,
        x: number,
        yPos: number,
        size: number,
        f = font,
        color = textColor
      ) => {
        page.drawText(text, { x, y: yPos, size, font: f, color });
      };

      const drawLine = (yPos: number) => {
        page.drawLine({
          start: { x: leftMargin, y: yPos },
          end: { x: width - leftMargin, y: yPos },
          thickness: 0.5,
          color: lineColor,
        });
      };

      // === CABEÇALHO ===
      drawText(
        "DOCUMENTO AUXILIAR DA NOTA FISCAL DE SERVIÇO ELETRÔNICA",
        leftMargin,
        y,
        10,
        fontBold,
        titleColor
      );
      y -= 15;
      drawText("DANFSE", leftMargin, y, 8, font, labelColor);
      y -= 25;
      drawLine(y);
      y -= 20;

      // === DADOS DA EMPRESA ===
      drawText("PRESTADOR DE SERVIÇOS", leftMargin, y, 8, fontBold, titleColor);
      y -= 15;
      if (company) {
        drawText(company.name || "Empresa", leftMargin, y, 11, fontBold);
        y -= 14;
        drawText(
          `CNPJ: ${company.cnpj}`,
          leftMargin,
          y,
          9,
          font,
          labelColor
        );
        y -= 14;
      }
      y -= 10;
      drawLine(y);
      y -= 20;

      // === NFS-e ===
      drawText("NFS-e", leftMargin, y, 8, fontBold, titleColor);
      y -= 15;
      drawText(`Número: ${doc.numero || "-"}`, leftMargin, y, 10, fontBold);
      y -= 14;
      drawText(
        `Código de Verificação: ${doc.codigoVerificacao || "-"}`,
        leftMargin,
        y,
        9
      );
      y -= 14;
      drawText(
        `Data de Emissão: ${doc.emitidaEm ? new Date(doc.emitidaEm).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "-"}`,
        leftMargin,
        y,
        9
      );
      y -= 14;
      drawText(
        `RPS: ${doc.providerRef || "-"}`,
        leftMargin,
        y,
        9,
        font,
        labelColor
      );
      y -= 20;
      drawLine(y);
      y -= 20;

      // === TOMADOR ===
      drawText(
        "TOMADOR DE SERVIÇOS",
        leftMargin,
        y,
        8,
        fontBold,
        titleColor
      );
      y -= 15;
      drawText(doc.tomadorNome || "-", leftMargin, y, 10, fontBold);
      y -= 14;
      if (doc.tomadorDocumento) {
        drawText(
          `CPF/CNPJ: ${doc.tomadorDocumento}`,
          leftMargin,
          y,
          9,
          font,
          labelColor
        );
        y -= 14;
      }
      if (doc.tomadorEmail) {
        drawText(
          `Email: ${doc.tomadorEmail}`,
          leftMargin,
          y,
          9,
          font,
          labelColor
        );
        y -= 14;
      }
      if (doc.tomadorTelefone) {
        drawText(
          `Telefone: ${doc.tomadorTelefone}`,
          leftMargin,
          y,
          9,
          font,
          labelColor
        );
        y -= 14;
      }
      y -= 10;
      drawLine(y);
      y -= 20;

      // === DESCRIÇÃO DO SERVIÇO ===
      drawText(
        "DISCRIMINAÇÃO DOS SERVIÇOS",
        leftMargin,
        y,
        8,
        fontBold,
        titleColor
      );
      y -= 15;

      // Quebra texto longo em múltiplas linhas
      const descricao = doc.discriminacao || "-";
      const maxCharsPerLine = 85;
      const lines = [];
      for (let i = 0; i < descricao.length; i += maxCharsPerLine) {
        lines.push(descricao.slice(i, i + maxCharsPerLine));
      }
      for (const line of lines.slice(0, 8)) {
        drawText(line, leftMargin, y, 9);
        y -= 13;
      }
      y -= 10;
      drawLine(y);
      y -= 20;

      // === VALORES ===
      drawText("VALORES", leftMargin, y, 8, fontBold, titleColor);
      y -= 18;

      const formatMoney = (val: number) =>
        new Intl.NumberFormat("pt-BR", {
          style: "currency",
          currency: "BRL",
        }).format(val);

      const valorServicos = Number(doc.valorServicos) || 0;
      const aliquota = doc.aliquotaIss ? Number(doc.aliquotaIss) : 0;
      const valorIss = doc.valorIss ? Number(doc.valorIss) : 0;

      // Tabela de valores
      drawText("Valor dos Serviços:", leftMargin, y, 9, font, labelColor);
      drawText(formatMoney(valorServicos), leftMargin + 200, y, 10, fontBold);
      y -= 16;
      drawText("Alíquota ISS:", leftMargin, y, 9, font, labelColor);
      drawText(
        `${(aliquota * 100).toFixed(2)}%`,
        leftMargin + 200,
        y,
        10,
        fontBold
      );
      y -= 16;
      drawText("Valor do ISS:", leftMargin, y, 9, font, labelColor);
      drawText(formatMoney(valorIss), leftMargin + 200, y, 10, fontBold);
      y -= 16;
      drawText("Valor Líquido:", leftMargin, y, 9, font, labelColor);
      drawText(
        formatMoney(valorServicos - (doc.issRetido ? valorIss : 0)),
        leftMargin + 200,
        y,
        11,
        fontBold,
        titleColor
      );

      y -= 30;
      drawLine(y);
      y -= 15;

      // Rodapé
      drawText(
        "Documento gerado pelo sistema de NFS-e com certificado digital A1",
        leftMargin,
        y,
        7,
        font,
        labelColor
      );
      y -= 10;
      drawText(
        `Gerado em: ${new Date().toLocaleString("pt-BR")}`,
        leftMargin,
        y,
        7,
        font,
        labelColor
      );

      const pdfBytes = await pdfDoc.save();
      return Buffer.from(pdfBytes);
    } catch (err) {
      console.error("[NFS-e] Erro ao gerar DANFSE:", err);
      return null;
    }
  }

  /**
   * Cancela uma NFS-e autorizada via SEFAZ
   */
  async cancelar(
    nfseDocId: string,
    justificativa: string
  ): Promise<{
    status: NfseStatus;
    errorMessage: string | null;
  }> {
    const doc = await prisma.nfseServiceDocument.findUniqueOrThrow({
      where: { id: nfseDocId },
    });

    if (doc.status !== "authorized") {
      throw new Error("Apenas NFS-e autorizadas podem ser canceladas.");
    }

    if (!doc.numero) {
      throw new Error(
        "NFS-e sem número — não é possível cancelar. Tente consultar o status primeiro."
      );
    }

    try {
      const { config, certData, company } = await this.validatePrerequisites(
        doc.companyId
      );

      const result = await sefazNfseService.cancelar(
        config.sefazEndpoint!,
        certData,
        doc.numero,
        onlyDigits(company.cnpj),
        config.inscricaoMunicipal || "",
        config.codigoMunicipio || "",
        "1"
      );

      if (result.success) {
        await prisma.nfseServiceDocument.update({
          where: { id: nfseDocId },
          data: {
            status: "canceled",
            canceladaEm: new Date(),
          },
        });
        return { status: "canceled", errorMessage: null };
      } else {
        const errorMsg = result.errors
          .map((e) => `${e.codigo}: ${e.mensagem}`)
          .join("; ");
        return { status: doc.status, errorMessage: errorMsg };
      }
    } catch (err: any) {
      const errorMsg =
        err?.message || "Erro ao cancelar NFS-e via SEFAZ";
      return { status: doc.status, errorMessage: errorMsg };
    }
  }

  /**
   * Lista NFS-e de uma empresa
   */
  async listar(
    companyId: string,
    opts?: {
      status?: NfseStatus;
      page?: number;
      pageSize?: number;
    }
  ) {
    const page = opts?.page || 1;
    const pageSize = opts?.pageSize || 20;

    const where: any = { companyId };
    if (opts?.status) where.status = opts.status;

    const [items, total] = await Promise.all([
      prisma.nfseServiceDocument.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      prisma.nfseServiceDocument.count({ where }),
    ]);

    return {
      items,
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize),
    };
  }

  /**
   * Verifica status do certificado A1 da empresa
   */
  async getCertificateStatus(companyId: string): Promise<{
    hasCertificate: boolean;
    validTo: string | null;
    daysRemaining: number | null;
    status: "missing" | "valid" | "expiring" | "expired";
  }> {
    const cert = await prisma.companyCertificate.findFirst({
      where: { companyId, active: true },
      orderBy: { createdAt: "desc" },
      select: { validTo: true },
    });

    if (!cert) {
      return {
        hasCertificate: false,
        validTo: null,
        daysRemaining: null,
        status: "missing",
      };
    }

    if (!cert.validTo) {
      return {
        hasCertificate: true,
        validTo: null,
        daysRemaining: null,
        status: "valid",
      };
    }

    const now = Date.now();
    const daysRemaining = Math.ceil(
      (cert.validTo.getTime() - now) / (1000 * 60 * 60 * 24)
    );

    let status: "valid" | "expiring" | "expired";
    if (daysRemaining < 0) {
      status = "expired";
    } else if (daysRemaining <= 30) {
      status = "expiring";
    } else {
      status = "valid";
    }

    return {
      hasCertificate: true,
      validTo: cert.validTo.toISOString(),
      daysRemaining,
      status,
    };
  }
}

export const nfseService = new NfseService();
