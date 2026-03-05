/**
 * NFS-e SEFAZ Direct Service — Emissão de NFS-e diretamente no WebService
 * municipal via certificado A1, seguindo o padrão ABRASF 2.04.
 *
 * Fluxo: Construir XML RPS → Assinar com A1 → Enviar SOAP → Parsear resposta
 */

import https from "node:https";
import forge from "node-forge";
import axios from "axios";
import { XMLParser } from "fast-xml-parser";
import { SignedXml } from "xml-crypto";
import { prisma } from "../lib/prisma.js";
import { decryptBuffer, decryptText } from "../lib/crypto.js";

/* ─── Types ─── */

export interface CertificateData {
  pfxBuffer: Buffer;
  pfxPassword: string;
  certPem: string;
  keyPem: string;
  certBase64: string;
}

export interface RpsParams {
  numero: number;
  serie: string;
  tipo: number;
  dataEmissao: string;
  competencia: string;
  cnpjPrestador: string;
  inscricaoMunicipal: string;
  codigoMunicipio: string;
  valorServicos: number;
  aliquotaIss: number;
  issRetido: boolean;
  itemListaServico: string;
  codigoTributarioMunicipio: string;
  discriminacao: string;
  optanteSimplesNacional: boolean;
  naturezaOperacao: number;
  tomador: {
    cpfCnpj?: string;
    razaoSocial: string;
    email?: string;
    telefone?: string;
    endereco?: {
      logradouro: string;
      numero: string;
      bairro: string;
      codigoMunicipio: string;
      uf: string;
      cep: string;
    };
  };
}

export interface SefazEmissaoResult {
  success: boolean;
  numero?: string;
  codigoVerificacao?: string;
  dataEmissao?: string;
  linkNfse?: string;
  protocolo?: string;
  xmlResposta?: string;
  errors: Array<{ codigo: string; mensagem: string; correcao?: string }>;
}

export interface SefazCancelamentoResult {
  success: boolean;
  errors: Array<{ codigo: string; mensagem: string }>;
}

export interface SefazConsultaResult {
  success: boolean;
  numero?: string;
  codigoVerificacao?: string;
  dataEmissao?: string;
  errors: Array<{ codigo: string; mensagem: string }>;
}

/* ─── Helpers ─── */

function onlyDigits(value: string | null | undefined): string {
  return (value || "").replace(/\D/g, "");
}

function isCpf(doc: string): boolean {
  return onlyDigits(doc).length <= 11;
}

function escapeXml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/* ─── Service ─── */

export class SefazNfseService {
  /* ═══════════════════════════════════════════════════════════════
   * CERTIFICADO A1
   * ═══════════════════════════════════════════════════════════════ */

  /**
   * Carrega e descriptografa o certificado A1 da empresa do banco de dados
   */
  async loadCertificate(companyId: string): Promise<CertificateData> {
    const cert = await prisma.companyCertificate.findFirst({
      where: { companyId, active: true },
      orderBy: { createdAt: "desc" },
    });

    if (!cert) {
      throw new Error(
        "Certificado A1 não encontrado. Faça upload do certificado digital (.pfx) em Configurações > Certificado A1."
      );
    }

    if (cert.validTo && cert.validTo < new Date()) {
      throw new Error(
        "Certificado A1 expirado. Por favor, faça upload de um novo certificado válido."
      );
    }

    const pfxBuffer = decryptBuffer(Buffer.from(cert.pfxBlobEncrypted));
    const pfxPassword = decryptText(Buffer.from(cert.pfxPasswordEncrypted));
    const { certPem, keyPem, certBase64 } = this.extractPemFromPfx(pfxBuffer, pfxPassword);

    return { pfxBuffer, pfxPassword, certPem, keyPem, certBase64 };
  }

  /**
   * Extrai PEM (cert + chave) e DER base64 do PFX
   */
  private extractPemFromPfx(
    pfxBuffer: Buffer,
    password: string
  ): { certPem: string; keyPem: string; certBase64: string } {
    const asn1 = forge.asn1.fromDer(
      forge.util.createBuffer(pfxBuffer.toString("binary"))
    );
    const p12 = forge.pkcs12.pkcs12FromAsn1(asn1, password);

    const certBags =
      p12.getBags({ bagType: forge.pki.oids.certBag })[
        forge.pki.oids.certBag
      ] ?? [];
    const keyBags = [
      ...(p12.getBags({ bagType: forge.pki.oids.pkcs8ShroudedKeyBag })[
        forge.pki.oids.pkcs8ShroudedKeyBag
      ] ?? []),
      ...(p12.getBags({ bagType: forge.pki.oids.keyBag })[
        forge.pki.oids.keyBag
      ] ?? []),
    ];

    const cert = certBags.find((b) => b.cert)?.cert;
    const key = keyBags.find((b) => b.key)?.key;

    if (!cert || !key) {
      throw new Error(
        "Certificado A1 inválido: certificado ou chave privada não encontrados no arquivo .pfx."
      );
    }

    const certPem = forge.pki.certificateToPem(cert);
    const keyPem = forge.pki.privateKeyToPem(key);
    const certDer = forge.asn1
      .toDer(forge.pki.certificateToAsn1(cert))
      .getBytes();
    const certBase64 = forge.util.encode64(certDer);

    return { certPem, keyPem, certBase64 };
  }

  /* ═══════════════════════════════════════════════════════════════
   * XML BUILDING — ABRASF 2.04
   * ═══════════════════════════════════════════════════════════════ */

  /**
   * Constrói o XML do RPS individual (InfDeclaracaoPrestacaoServico)
   */
  buildRpsXml(rps: RpsParams): string {
    const tomadorDoc = onlyDigits(rps.tomador.cpfCnpj);
    const valorIss = Number(
      (rps.valorServicos * rps.aliquotaIss).toFixed(2)
    );
    const valorLiquido = rps.issRetido
      ? Number((rps.valorServicos - valorIss).toFixed(2))
      : rps.valorServicos;
    const issRetidoCode = rps.issRetido ? "1" : "2";

    // Tomador identificação
    let tomadorIdentificacao = "";
    if (tomadorDoc) {
      const docEl = isCpf(tomadorDoc)
        ? `<Cpf>${tomadorDoc}</Cpf>`
        : `<Cnpj>${tomadorDoc}</Cnpj>`;
      tomadorIdentificacao = `
          <IdentificacaoTomador>
            <CpfCnpj>${docEl}</CpfCnpj>
          </IdentificacaoTomador>`;
    }

    // Tomador endereço
    let tomadorEndereco = "";
    if (rps.tomador.endereco) {
      const e = rps.tomador.endereco;
      tomadorEndereco = `
          <Endereco>
            <Endereco>${escapeXml(e.logradouro)}</Endereco>
            <Numero>${escapeXml(e.numero)}</Numero>
            <Bairro>${escapeXml(e.bairro)}</Bairro>
            <CodigoMunicipio>${e.codigoMunicipio}</CodigoMunicipio>
            <Uf>${e.uf}</Uf>
            <Cep>${onlyDigits(e.cep)}</Cep>
          </Endereco>`;
    }

    // Tomador contato
    let tomadorContato = "";
    if (rps.tomador.telefone || rps.tomador.email) {
      const parts: string[] = [];
      if (rps.tomador.telefone) {
        parts.push(
          `<Telefone>${onlyDigits(rps.tomador.telefone)}</Telefone>`
        );
      }
      if (rps.tomador.email) {
        parts.push(`<Email>${escapeXml(rps.tomador.email)}</Email>`);
      }
      tomadorContato = `
          <Contato>${parts.join("")}</Contato>`;
    }

    // Remove pontos do item lista para formato ABRASF (ex: "14.01" → "1401")
    const itemLista = rps.itemListaServico.replace(/\./g, "");

    return `<Rps xmlns="http://www.abrasf.org.br/nfse.xsd">
      <InfDeclaracaoPrestacaoServico Id="rps${rps.numero}">
        <Rps>
          <IdentificacaoRps>
            <Numero>${rps.numero}</Numero>
            <Serie>${escapeXml(rps.serie)}</Serie>
            <Tipo>${rps.tipo}</Tipo>
          </IdentificacaoRps>
          <DataEmissao>${rps.dataEmissao}</DataEmissao>
          <Status>1</Status>
        </Rps>
        <Competencia>${rps.competencia}</Competencia>
        <Servico>
          <Valores>
            <ValorServicos>${rps.valorServicos.toFixed(2)}</ValorServicos>
            <IssRetido>${issRetidoCode}</IssRetido>
            <ValorIss>${valorIss.toFixed(2)}</ValorIss>
            <BaseCalculo>${rps.valorServicos.toFixed(2)}</BaseCalculo>
            <Aliquota>${rps.aliquotaIss.toFixed(4)}</Aliquota>
            <ValorLiquidoNfse>${valorLiquido.toFixed(2)}</ValorLiquidoNfse>
          </Valores>
          <ItemListaServico>${itemLista}</ItemListaServico>
          <CodigoTributacaoMunicipio>${rps.codigoTributarioMunicipio}</CodigoTributacaoMunicipio>
          <Discriminacao>${escapeXml(rps.discriminacao)}</Discriminacao>
          <CodigoMunicipio>${rps.codigoMunicipio}</CodigoMunicipio>
        </Servico>
        <Prestador>
          <CpfCnpj>
            <Cnpj>${onlyDigits(rps.cnpjPrestador)}</Cnpj>
          </CpfCnpj>
          <InscricaoMunicipal>${rps.inscricaoMunicipal}</InscricaoMunicipal>
        </Prestador>
        <Tomador>${tomadorIdentificacao}
          <RazaoSocial>${escapeXml(rps.tomador.razaoSocial)}</RazaoSocial>${tomadorEndereco}${tomadorContato}
        </Tomador>
        <OptanteSimplesNacional>${rps.optanteSimplesNacional ? "1" : "2"}</OptanteSimplesNacional>
        <IncentivoFiscal>2</IncentivoFiscal>
      </InfDeclaracaoPrestacaoServico>
    </Rps>`;
  }

  /**
   * Constrói o XML do lote RPS síncrono (EnviarLoteRpsSincronoEnvio)
   */
  buildLoteRpsSincronoXml(
    cnpj: string,
    inscricaoMunicipal: string,
    numeroLote: number,
    rpsXml: string
  ): string {
    return `<EnviarLoteRpsSincronoEnvio xmlns="http://www.abrasf.org.br/nfse.xsd">
  <LoteRps Id="lote${numeroLote}" versao="2.04">
    <NumeroLote>${numeroLote}</NumeroLote>
    <CpfCnpj>
      <Cnpj>${onlyDigits(cnpj)}</Cnpj>
    </CpfCnpj>
    <InscricaoMunicipal>${inscricaoMunicipal}</InscricaoMunicipal>
    <QuantidadeRps>1</QuantidadeRps>
    <ListaRps>
      ${rpsXml}
    </ListaRps>
  </LoteRps>
</EnviarLoteRpsSincronoEnvio>`;
  }

  /**
   * Constrói XML de cancelamento de NFS-e
   */
  buildCancelarNfseXml(
    numero: string,
    cnpj: string,
    inscricaoMunicipal: string,
    codigoMunicipio: string,
    codigoCancelamento: string = "1"
  ): string {
    return `<CancelarNfseEnvio xmlns="http://www.abrasf.org.br/nfse.xsd">
  <Pedido>
    <InfPedidoCancelamento Id="cancel${numero}">
      <IdentificacaoNfse>
        <Numero>${numero}</Numero>
        <CpfCnpj>
          <Cnpj>${onlyDigits(cnpj)}</Cnpj>
        </CpfCnpj>
        <InscricaoMunicipal>${inscricaoMunicipal}</InscricaoMunicipal>
        <CodigoMunicipio>${codigoMunicipio}</CodigoMunicipio>
      </IdentificacaoNfse>
      <CodigoCancelamento>${codigoCancelamento}</CodigoCancelamento>
    </InfPedidoCancelamento>
  </Pedido>
</CancelarNfseEnvio>`;
  }

  /**
   * Constrói XML de consulta por RPS
   */
  buildConsultarNfsePorRpsXml(
    numero: number,
    serie: string,
    tipo: number,
    cnpj: string,
    inscricaoMunicipal: string
  ): string {
    return `<ConsultarNfseRpsEnvio xmlns="http://www.abrasf.org.br/nfse.xsd">
  <IdentificacaoRps>
    <Numero>${numero}</Numero>
    <Serie>${serie}</Serie>
    <Tipo>${tipo}</Tipo>
  </IdentificacaoRps>
  <Prestador>
    <CpfCnpj>
      <Cnpj>${onlyDigits(cnpj)}</Cnpj>
    </CpfCnpj>
    <InscricaoMunicipal>${inscricaoMunicipal}</InscricaoMunicipal>
  </Prestador>
</ConsultarNfseRpsEnvio>`;
  }

  /* ═══════════════════════════════════════════════════════════════
   * ASSINATURA XML (XMLDSig)
   * ═══════════════════════════════════════════════════════════════ */

  /**
   * Assina um elemento XML com XMLDSig (Enveloped Signature + Exclusive C14N)
   */
  signXml(
    xml: string,
    referenceId: string,
    certPem: string,
    keyPem: string,
  ): string {
    const sig = new SignedXml({
      privateKey: keyPem,
      publicCert: certPem,
      signatureAlgorithm: "http://www.w3.org/2000/09/xmldsig#rsa-sha1",
      canonicalizationAlgorithm: "http://www.w3.org/2001/10/xml-exc-c14n#",
    });

    sig.addReference({
      xpath: `//*[@Id='${referenceId}']`,
      transforms: [
        "http://www.w3.org/2000/09/xmldsig#enveloped-signature",
        "http://www.w3.org/2001/10/xml-exc-c14n#",
      ],
      digestAlgorithm: "http://www.w3.org/2000/09/xmldsig#sha1",
    });

    sig.computeSignature(xml, {
      location: {
        reference: `//*[@Id='${referenceId}']`,
        action: "after",
      },
    });

    return sig.getSignedXml();
  }

  /* ═══════════════════════════════════════════════════════════════
   * SOAP ENVELOPE
   * ═══════════════════════════════════════════════════════════════ */

  /**
   * Cabeçalho ABRASF padrão
   */
  private buildCabecalho(): string {
    return `<cabecalho xmlns="http://www.abrasf.org.br/nfse.xsd" versao="2.04"><versaoDados>2.04</versaoDados></cabecalho>`;
  }

  /**
   * Envelope SOAP para operação ABRASF
   */
  wrapSoapEnvelope(operation: string, signedXml: string): string {
    const cabecalho = this.buildCabecalho();
    return [
      `<?xml version="1.0" encoding="UTF-8"?>`,
      `<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/" xmlns:nfse="http://nfse.abrasf.org.br">`,
      `  <soap:Body>`,
      `    <nfse:${operation}Request>`,
      `      <nfseCabecMsg><![CDATA[${cabecalho}]]></nfseCabecMsg>`,
      `      <nfseDadosMsg><![CDATA[${signedXml}]]></nfseDadosMsg>`,
      `    </nfse:${operation}Request>`,
      `  </soap:Body>`,
      `</soap:Envelope>`,
    ].join("\n");
  }

  /* ═══════════════════════════════════════════════════════════════
   * COMUNICAÇÃO SOAP COM SEFAZ
   * ═══════════════════════════════════════════════════════════════ */

  /**
   * Envia requisição SOAP para o WebService SEFAZ municipal
   */
  async sendToSefaz(
    endpoint: string,
    soapXml: string,
    pfxBuffer: Buffer,
    pfxPassword: string,
    soapAction?: string
  ): Promise<string> {
    const agent = new https.Agent({
      pfx: pfxBuffer,
      passphrase: pfxPassword,
      keepAlive: false,
      minVersion: "TLSv1.2",
    });

    const headers: Record<string, string> = {
      "Content-Type": "text/xml; charset=utf-8",
    };
    if (soapAction) {
      headers["SOAPAction"] = soapAction;
    }

    try {
      const response = await axios.post(endpoint, soapXml, {
        httpsAgent: agent,
        headers,
        timeout: 60000,
        responseType: "text",
        maxBodyLength: Infinity,
        maxContentLength: Infinity,
      });
      return typeof response.data === "string"
        ? response.data
        : String(response.data);
    } catch (err: any) {
      if (err?.response?.data) {
        // SEFAZ retornou resposta com erro HTTP, mas temos o XML
        return typeof err.response.data === "string"
          ? err.response.data
          : String(err.response.data);
      }
      throw new Error(
        `Falha na comunicação com SEFAZ: ${err?.message || "Erro desconhecido"}`
      );
    }
  }

  /* ═══════════════════════════════════════════════════════════════
   * PARSING DE RESPOSTA XML
   * ═══════════════════════════════════════════════════════════════ */

  private createParser(): XMLParser {
    return new XMLParser({
      ignoreAttributes: false,
      removeNSPrefix: true,
      parseTagValue: true,
      trimValues: true,
    });
  }

  /**
   * Parseia resposta de emissão (EnviarLoteRpsSincronoResposta)
   */
  parseEmissaoResponse(responseXml: string): SefazEmissaoResult {
    try {
      const parser = this.createParser();
      let parsed = parser.parse(responseXml);

      // Navega pelo envelope SOAP
      const body = this.extractSoapBody(parsed);
      if (!body) {
        return {
          success: false,
          errors: [{ codigo: "PARSE", mensagem: "Resposta SOAP vazia ou inválida" }],
        };
      }

      // Tenta encontrar o elemento de resposta real
      let responseEl = this.findDeep(body, [
        "EnviarLoteRpsSincronoResposta",
        "RecepcionarLoteRpsSincronoResposta",
        "EnviarLoteRpsSincronoResult",
        "return",
        "outputXML",
      ]);

      // Alguns serviços retornam a resposta como CDATA string
      if (typeof responseEl === "string") {
        responseEl = parser.parse(responseEl);
        responseEl =
          responseEl?.EnviarLoteRpsSincronoResposta ||
          responseEl?.RecepcionarLoteRpsSincronoResposta ||
          responseEl;
      }

      if (!responseEl) {
        responseEl = body;
      }

      // Verifica erros
      const errors = this.extractErrors(responseEl);
      if (errors.length > 0) {
        return { success: false, errors, xmlResposta: responseXml };
      }

      // Extrai NFS-e
      const nfseData = this.extractNfseData(responseEl);
      if (nfseData) {
        return {
          success: true,
          numero: nfseData.numero,
          codigoVerificacao: nfseData.codigoVerificacao,
          dataEmissao: nfseData.dataEmissao,
          protocolo: nfseData.protocolo,
          xmlResposta: responseXml,
          errors: [],
        };
      }

      return {
        success: false,
        xmlResposta: responseXml,
        errors: [
          {
            codigo: "PARSE",
            mensagem: "Resposta não contém dados da NFS-e autorizada",
          },
        ],
      };
    } catch (err: any) {
      return {
        success: false,
        errors: [
          {
            codigo: "PARSE_ERROR",
            mensagem: `Erro ao parsear resposta: ${err?.message || "desconhecido"}`,
          },
        ],
      };
    }
  }

  /**
   * Parseia resposta de cancelamento
   */
  parseCancelamentoResponse(responseXml: string): SefazCancelamentoResult {
    try {
      const parser = this.createParser();
      let parsed = parser.parse(responseXml);

      const body = this.extractSoapBody(parsed);
      let responseEl = this.findDeep(body || parsed, [
        "CancelarNfseResposta",
        "CancelarNfseResult",
        "return",
      ]);

      if (typeof responseEl === "string") {
        responseEl = parser.parse(responseEl);
        responseEl = responseEl?.CancelarNfseResposta || responseEl;
      }

      if (!responseEl) responseEl = body || parsed;

      const errors = this.extractErrors(responseEl);
      if (errors.length > 0) {
        return { success: false, errors };
      }

      // Verifica se tem confirmação de cancelamento
      const cancelamento = this.findDeep(responseEl, [
        "RetCancelamento",
        "NfseCancelamento",
        "Confirmacao",
      ]);

      return {
        success: !!cancelamento || errors.length === 0,
        errors: [],
      };
    } catch (err: any) {
      return {
        success: false,
        errors: [
          {
            codigo: "PARSE_ERROR",
            mensagem: `Erro ao parsear resposta de cancelamento: ${err?.message || "desconhecido"}`,
          },
        ],
      };
    }
  }

  /**
   * Parseia resposta de consulta por RPS
   */
  parseConsultaResponse(responseXml: string): SefazConsultaResult {
    try {
      const parser = this.createParser();
      let parsed = parser.parse(responseXml);

      const body = this.extractSoapBody(parsed);
      let responseEl = this.findDeep(body || parsed, [
        "ConsultarNfseRpsResposta",
        "ConsultarNfsePorRpsResposta",
        "ConsultarNfseRpsResult",
        "return",
      ]);

      if (typeof responseEl === "string") {
        responseEl = parser.parse(responseEl);
        responseEl =
          responseEl?.ConsultarNfseRpsResposta ||
          responseEl?.ConsultarNfsePorRpsResposta ||
          responseEl;
      }

      if (!responseEl) responseEl = body || parsed;

      const errors = this.extractErrors(responseEl);
      if (errors.length > 0) {
        return { success: false, errors };
      }

      const nfseData = this.extractNfseData(responseEl);
      if (nfseData) {
        return {
          success: true,
          numero: nfseData.numero,
          codigoVerificacao: nfseData.codigoVerificacao,
          dataEmissao: nfseData.dataEmissao,
          errors: [],
        };
      }

      return {
        success: false,
        errors: [
          {
            codigo: "NOT_FOUND",
            mensagem: "NFS-e não encontrada para o RPS informado",
          },
        ],
      };
    } catch (err: any) {
      return {
        success: false,
        errors: [
          {
            codigo: "PARSE_ERROR",
            mensagem: `Erro ao parsear consulta: ${err?.message || "desconhecido"}`,
          },
        ],
      };
    }
  }

  /* ─── Helpers de parsing ─── */

  private extractSoapBody(parsed: any): any {
    if (!parsed || typeof parsed !== "object") return null;

    // Tenta variações de namespace no envelope SOAP
    for (const envKey of Object.keys(parsed)) {
      if (envKey.toLowerCase().includes("envelope")) {
        const env = parsed[envKey];
        for (const bodyKey of Object.keys(env || {})) {
          if (bodyKey.toLowerCase().includes("body")) {
            return env[bodyKey];
          }
        }
      }
    }

    // Sem envelope SOAP — retorna como está
    return parsed;
  }

  private findDeep(obj: any, keys: string[]): any {
    if (!obj || typeof obj !== "object") return null;

    for (const key of keys) {
      if (obj[key] !== undefined) return obj[key];
    }

    for (const objKey of Object.keys(obj)) {
      const found = this.findDeep(obj[objKey], keys);
      if (found !== null) return found;
    }

    return null;
  }

  private extractErrors(
    obj: any
  ): Array<{ codigo: string; mensagem: string; correcao?: string }> {
    if (!obj || typeof obj !== "object") return [];

    const lista =
      obj.ListaMensagemRetorno ||
      obj.ListaMensagemAlerta ||
      this.findDeep(obj, [
        "ListaMensagemRetorno",
        "ListaMensagemAlerta",
      ]);

    if (!lista) return [];

    const msgs = lista.MensagemRetorno || lista;
    const arr = Array.isArray(msgs) ? msgs : msgs ? [msgs] : [];

    return arr
      .map((m: any) => ({
        codigo: String(m.Codigo || m.codigo || ""),
        mensagem: String(m.Mensagem || m.mensagem || ""),
        correcao: m.Correcao || m.correcao || undefined,
      }))
      .filter((m) => m.codigo || m.mensagem);
  }

  private extractNfseData(obj: any): {
    numero: string;
    codigoVerificacao: string;
    dataEmissao: string;
    protocolo?: string;
  } | null {
    if (!obj || typeof obj !== "object") return null;

    // Busca CompNfse → Nfse → InfNfse
    const compNfse = this.findDeep(obj, ["CompNfse"]);
    if (compNfse) {
      const nfse = compNfse.Nfse || compNfse;
      const infNfse = nfse.InfNfse || nfse;

      const numero = infNfse.Numero || infNfse.numero;
      if (numero) {
        return {
          numero: String(numero),
          codigoVerificacao: String(
            infNfse.CodigoVerificacao || infNfse.codigoVerificacao || ""
          ),
          dataEmissao: String(
            infNfse.DataEmissao || infNfse.dataEmissao || ""
          ),
          protocolo: infNfse.NumeroLote
            ? String(infNfse.NumeroLote)
            : undefined,
        };
      }
    }

    // Busca ListaNfse → CompNfse
    const listaNfse = this.findDeep(obj, ["ListaNfse"]);
    if (listaNfse) {
      return this.extractNfseData(listaNfse);
    }

    return null;
  }

  /* ═══════════════════════════════════════════════════════════════
   * OPERAÇÕES DE ALTO NÍVEL
   * ═══════════════════════════════════════════════════════════════ */

  /**
   * Emite NFS-e via SEFAZ — fluxo completo
   */
  async emitir(
    endpoint: string,
    certData: CertificateData,
    rps: RpsParams,
    numeroLote: number
  ): Promise<SefazEmissaoResult> {
    // 1. Constrói XML do RPS
    const rpsXml = this.buildRpsXml(rps);

    // 2. Assina o InfDeclaracaoPrestacaoServico
    const rpsSignedXml = this.signXml(
      rpsXml,
      `rps${rps.numero}`,
      certData.certPem,
      certData.keyPem
    );

    // 3. Constrói XML do lote
    const loteXml = this.buildLoteRpsSincronoXml(
      rps.cnpjPrestador,
      rps.inscricaoMunicipal,
      numeroLote,
      rpsSignedXml
    );

    // 4. Assina o LoteRps
    const loteSignedXml = this.signXml(
      loteXml,
      `lote${numeroLote}`,
      certData.certPem,
      certData.keyPem
    );

    // 5. Envelope SOAP
    const soapXml = this.wrapSoapEnvelope(
      "RecepcionarLoteRpsSincrono",
      loteSignedXml
    );

    // 6. Envia para SEFAZ
    console.log(
      `[NFS-e SEFAZ] Enviando lote ${numeroLote} para ${endpoint}...`
    );
    const responseXml = await this.sendToSefaz(
      endpoint,
      soapXml,
      certData.pfxBuffer,
      certData.pfxPassword,
      "RecepcionarLoteRpsSincrono"
    );

    // 7. Parseia resposta
    const result = this.parseEmissaoResponse(responseXml);

    if (result.success) {
      console.log(
        `[NFS-e SEFAZ] NFS-e autorizada: nº ${result.numero}, verificação: ${result.codigoVerificacao}`
      );
    } else {
      console.error(
        `[NFS-e SEFAZ] Erros na emissão:`,
        result.errors
          .map((e) => `${e.codigo}: ${e.mensagem}`)
          .join("; ")
      );
    }

    return result;
  }

  /**
   * Cancela NFS-e via SEFAZ
   */
  async cancelar(
    endpoint: string,
    certData: CertificateData,
    numero: string,
    cnpj: string,
    inscricaoMunicipal: string,
    codigoMunicipio: string,
    codigoCancelamento: string = "1"
  ): Promise<SefazCancelamentoResult> {
    // 1. Constrói XML
    const cancelXml = this.buildCancelarNfseXml(
      numero,
      cnpj,
      inscricaoMunicipal,
      codigoMunicipio,
      codigoCancelamento
    );

    // 2. Assina
    const signedXml = this.signXml(
      cancelXml,
      `cancel${numero}`,
      certData.certPem,
      certData.keyPem
    );

    // 3. Envelope SOAP
    const soapXml = this.wrapSoapEnvelope("CancelarNfse", signedXml);

    // 4. Envia
    console.log(`[NFS-e SEFAZ] Cancelando NFS-e nº ${numero}...`);
    const responseXml = await this.sendToSefaz(
      endpoint,
      soapXml,
      certData.pfxBuffer,
      certData.pfxPassword,
      "CancelarNfse"
    );

    // 5. Parseia resposta
    return this.parseCancelamentoResponse(responseXml);
  }

  /**
   * Consulta NFS-e por RPS
   */
  async consultarPorRps(
    endpoint: string,
    certData: CertificateData,
    numero: number,
    serie: string,
    tipo: number,
    cnpj: string,
    inscricaoMunicipal: string
  ): Promise<SefazConsultaResult> {
    const consultaXml = this.buildConsultarNfsePorRpsXml(
      numero,
      serie,
      tipo,
      cnpj,
      inscricaoMunicipal
    );

    const soapXml = this.wrapSoapEnvelope(
      "ConsultarNfsePorRps",
      consultaXml
    );

    const responseXml = await this.sendToSefaz(
      endpoint,
      soapXml,
      certData.pfxBuffer,
      certData.pfxPassword,
      "ConsultarNfsePorRps"
    );

    return this.parseConsultaResponse(responseXml);
  }
}

export const sefazNfseService = new SefazNfseService();
