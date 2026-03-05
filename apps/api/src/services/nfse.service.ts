/**
 * NFS-e Service — Integração real com FocusNFe para emissão de
 * Nota Fiscal de Serviço Eletrônica.
 *
 * Fluxo: Criar NFS-e → Poll status → Baixar PDF → Enviar por WhatsApp
 */

import axios, { type AxiosInstance } from "axios";
import { prisma } from "../lib/prisma.js";
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

interface FocusNFeCreatePayload {
  data_emissao: string;
  prestador: {
    cnpj: string;
    inscricao_municipal?: string;
    codigo_municipio?: string;
  };
  tomador: {
    cnpj?: string;
    cpf?: string;
    razao_social: string;
    email?: string;
    telefone?: string;
    endereco?: {
      logradouro?: string;
      numero?: string;
      bairro?: string;
      codigo_municipio?: string;
      uf?: string;
      cep?: string;
    };
  };
  servico: {
    valor_servicos: number;
    iss_retido: boolean;
    item_lista_servico?: string;
    discriminacao: string;
    codigo_tributario_municipio?: string;
    aliquota?: number;
  };
  natureza_operacao?: number;
  regime_especial_tributacao?: number;
  optante_simples_nacional?: boolean;
  incentivador_cultural?: boolean;
  status?: string;
}

interface FocusNFeResponse {
  ref?: string;
  status: string;
  numero?: string;
  codigo_verificacao?: string;
  url?: string;
  caminho_xml_nota_fiscal?: string;
  url_danfse?: string;
  erros?: Array<{ codigo: string; mensagem: string; correcao?: string }>;
  mensagem?: string;
}

/* ─── Helpers ─── */

function isCpf(doc: string): boolean {
  return doc.replace(/\D/g, "").length <= 11;
}

function onlyDigits(value: string | null | undefined): string {
  return (value || "").replace(/\D/g, "");
}

/* ─── Service ─── */

export class NfseService {
  /**
   * Cria o client HTTP para FocusNFe
   */
  private async getClient(companyId: string): Promise<{
    client: AxiosInstance;
    config: NonNullable<Awaited<ReturnType<typeof this.getConfig>>>;
  }> {
    const config = await this.getConfig(companyId);
    if (!config) {
      throw new Error("NFS-e não configurada para esta empresa. Configure em Configurações > NFS-e.");
    }
    if (!config.apiToken) {
      throw new Error("Token da API de NFS-e não configurado.");
    }

    const baseURL =
      config.environment === "producao"
        ? "https://api.focusnfe.com.br"
        : "https://homologacao.focusnfe.com.br";

    const client = axios.create({
      baseURL,
      auth: {
        username: config.apiToken,
        password: "",
      },
      headers: {
        "Content-Type": "application/json",
      },
      timeout: 30000,
    });

    return { client, config };
  }

  /**
   * Busca a configuração NFS-e da empresa
   */
  async getConfig(companyId: string) {
    return prisma.nfseConfig.findUnique({ where: { companyId } });
  }

  /**
   * Salva/atualiza configuração NFS-e
   */
  async upsertConfig(companyId: string, data: {
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
  }) {
    return prisma.nfseConfig.upsert({
      where: { companyId },
      create: { companyId, ...data },
      update: data,
    });
  }

  /**
   * Emite uma NFS-e real via FocusNFe
   */
  async emitir(input: NfseEmissaoInput): Promise<{
    nfseDocId: string;
    status: NfseStatus;
    providerRef: string | null;
    errorMessage: string | null;
  }> {
    const { client, config } = await this.getClient(input.companyId);

    const company = await prisma.company.findUniqueOrThrow({
      where: { id: input.companyId },
    });

    // Gera ref única para a NFS-e
    const ref = `nfse-${input.companyId.slice(-6)}-${Date.now()}`;

    const tomadorDoc = onlyDigits(input.tomador.cpfCnpj);
    const tomadorField = tomadorDoc.length > 0
      ? isCpf(tomadorDoc) ? { cpf: tomadorDoc } : { cnpj: tomadorDoc }
      : {};

    const payload: FocusNFeCreatePayload = {
      data_emissao: new Date().toISOString().slice(0, 19),
      prestador: {
        cnpj: onlyDigits(company.cnpj),
        inscricao_municipal: config.inscricaoMunicipal || undefined,
        codigo_municipio: config.codigoMunicipio || undefined,
      },
      tomador: {
        ...tomadorField,
        razao_social: input.tomador.nome,
        email: input.tomador.email || undefined,
        telefone: input.tomador.telefone || undefined,
        endereco: input.tomador.logradouro
          ? {
            logradouro: input.tomador.logradouro,
            numero: input.tomador.numero || "S/N",
            bairro: input.tomador.bairro,
            codigo_municipio: input.tomador.codigoMunicipio || config.codigoMunicipio || undefined,
            uf: input.tomador.uf,
            cep: input.tomador.cep,
          }
          : undefined,
      },
      servico: {
        valor_servicos: input.valorServicos,
        iss_retido: config.issRetido,
        item_lista_servico: config.itemListaServico || undefined,
        discriminacao: input.discriminacao,
        codigo_tributario_municipio: config.codigoTributarioMunicipio || undefined,
        aliquota: config.aliquotaIss ? Number(config.aliquotaIss) : undefined,
      },
      natureza_operacao: config.naturezaOperacao || 1,
      optante_simples_nacional: (config.regimeTributario || 1) === 1,
      incentivador_cultural: false,
    };

    // Salva o documento no banco antes de enviar
    const nfseDoc = await prisma.nfseServiceDocument.create({
      data: {
        companyId: input.companyId,
        appointmentId: input.appointmentId || null,
        providerRef: ref,
        status: "processing",
        valorServicos: input.valorServicos,
        aliquotaIss: config.aliquotaIss ? Number(config.aliquotaIss) : null,
        valorIss: config.aliquotaIss
          ? Number((input.valorServicos * Number(config.aliquotaIss)).toFixed(2))
          : null,
        discriminacao: input.discriminacao,
        tomadorNome: input.tomador.nome,
        tomadorDocumento: input.tomador.cpfCnpj || null,
        tomadorEmail: input.tomador.email || null,
        tomadorTelefone: input.tomador.telefone || null,
        providerPayload: payload as any,
      },
    });

    try {
      const response = await client.post<FocusNFeResponse>(
        `/v2/nfse?ref=${ref}`,
        payload,
      );

      const data = response.data;
      const newStatus = this.mapProviderStatus(data.status);

      await prisma.nfseServiceDocument.update({
        where: { id: nfseDoc.id },
        data: {
          status: newStatus,
          numero: data.numero || null,
          codigoVerificacao: data.codigo_verificacao || null,
          pdfUrl: data.url_danfse || data.url || null,
          xmlUrl: data.caminho_xml_nota_fiscal || null,
          providerResponse: data as any,
          emitidaEm: newStatus === "authorized" ? new Date() : null,
          errorMessage: data.erros
            ? data.erros.map((e) => `${e.codigo}: ${e.mensagem}`).join("; ")
            : null,
        },
      });

      return {
        nfseDocId: nfseDoc.id,
        status: newStatus,
        providerRef: ref,
        errorMessage: data.erros
          ? data.erros.map((e) => e.mensagem).join("; ")
          : null,
      };
    } catch (err: any) {
      const errorMsg = err?.response?.data?.mensagem
        || err?.response?.data?.erros?.[0]?.mensagem
        || err?.message
        || "Erro desconhecido ao emitir NFS-e";

      await prisma.nfseServiceDocument.update({
        where: { id: nfseDoc.id },
        data: {
          status: "error",
          errorMessage: errorMsg,
          providerResponse: err?.response?.data || null,
        },
      });

      return {
        nfseDocId: nfseDoc.id,
        status: "error" as NfseStatus,
        providerRef: ref,
        errorMessage: errorMsg,
      };
    }
  }

  /**
   * Consulta o status de uma NFS-e no provedor e atualiza o banco
   */
  async consultarStatus(nfseDocId: string): Promise<{
    status: NfseStatus;
    pdfUrl: string | null;
    numero: string | null;
  }> {
    const doc = await prisma.nfseServiceDocument.findUniqueOrThrow({
      where: { id: nfseDocId },
    });

    if (!doc.providerRef) {
      return { status: doc.status, pdfUrl: doc.pdfUrl, numero: doc.numero };
    }

    const { client } = await this.getClient(doc.companyId);

    try {
      const response = await client.get<FocusNFeResponse>(
        `/v2/nfse/${doc.providerRef}`,
      );

      const data = response.data;
      const newStatus = this.mapProviderStatus(data.status);

      await prisma.nfseServiceDocument.update({
        where: { id: nfseDocId },
        data: {
          status: newStatus,
          numero: data.numero || doc.numero,
          codigoVerificacao: data.codigo_verificacao || doc.codigoVerificacao,
          pdfUrl: data.url_danfse || data.url || doc.pdfUrl,
          xmlUrl: data.caminho_xml_nota_fiscal || doc.xmlUrl,
          providerResponse: data as any,
          emitidaEm: newStatus === "authorized" && !doc.emitidaEm ? new Date() : doc.emitidaEm,
          errorMessage: data.erros
            ? data.erros.map((e) => `${e.codigo}: ${e.mensagem}`).join("; ")
            : doc.errorMessage,
        },
      });

      return {
        status: newStatus,
        pdfUrl: data.url_danfse || data.url || doc.pdfUrl,
        numero: data.numero || doc.numero,
      };
    } catch (err: any) {
      return { status: doc.status, pdfUrl: doc.pdfUrl, numero: doc.numero };
    }
  }

  /**
   * Baixa o PDF de uma NFS-e autorizada
   */
  async downloadPdf(nfseDocId: string): Promise<Buffer | null> {
    const doc = await prisma.nfseServiceDocument.findUniqueOrThrow({
      where: { id: nfseDocId },
    });

    // Se tem PDF em base64 salvo, retornar direto
    if (doc.pdfBase64) {
      return Buffer.from(doc.pdfBase64, "base64");
    }

    // Se tem URL, baixar
    if (doc.pdfUrl) {
      try {
        const response = await axios.get(doc.pdfUrl, {
          responseType: "arraybuffer",
          timeout: 15000,
        });
        const buffer = Buffer.from(response.data);

        // Salva o PDF em base64 para cache
        await prisma.nfseServiceDocument.update({
          where: { id: nfseDocId },
          data: { pdfBase64: buffer.toString("base64") },
        });

        return buffer;
      } catch {
        return null;
      }
    }

    // Tenta buscar via API do provedor
    if (doc.providerRef) {
      try {
        const { client } = await this.getClient(doc.companyId);
        const response = await client.get(`/v2/nfse/${doc.providerRef}/pdf`, {
          responseType: "arraybuffer",
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

    return null;
  }

  /**
   * Cancela uma NFS-e autorizada
   */
  async cancelar(nfseDocId: string, justificativa: string): Promise<{
    status: NfseStatus;
    errorMessage: string | null;
  }> {
    const doc = await prisma.nfseServiceDocument.findUniqueOrThrow({
      where: { id: nfseDocId },
    });

    if (doc.status !== "authorized") {
      throw new Error("Apenas NFS-e autorizadas podem ser canceladas.");
    }

    const { client } = await this.getClient(doc.companyId);

    try {
      await client.delete(`/v2/nfse/${doc.providerRef}`, {
        data: { justificativa },
      });

      await prisma.nfseServiceDocument.update({
        where: { id: nfseDocId },
        data: {
          status: "canceled",
          canceladaEm: new Date(),
        },
      });

      return { status: "canceled", errorMessage: null };
    } catch (err: any) {
      const errorMsg = err?.response?.data?.mensagem || err?.message || "Erro ao cancelar";
      return { status: doc.status, errorMessage: errorMsg };
    }
  }

  /**
   * Lista NFS-e de uma empresa
   */
  async listar(companyId: string, opts?: {
    status?: NfseStatus;
    page?: number;
    pageSize?: number;
  }) {
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

  /* ─── Mappers ─── */

  private mapProviderStatus(providerStatus: string): NfseStatus {
    switch (providerStatus?.toLowerCase()) {
      case "autorizado":
      case "authorized":
        return "authorized";
      case "cancelado":
      case "cancelled":
      case "canceled":
        return "canceled";
      case "erro_autorizacao":
      case "error":
        return "error";
      case "negado":
      case "rejected":
        return "rejected";
      case "processando_autorizacao":
      case "processing":
        return "processing";
      default:
        return "processing";
    }
  }
}

export const nfseService = new NfseService();
