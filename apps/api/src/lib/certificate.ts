import forge from "node-forge";

export type CertificateStatus = "missing" | "valid" | "expiring" | "expired" | "unknown";

export interface ParsedCertificateInfo {
  validFrom: Date | null;
  validTo: Date | null;
  uf: string | null;
  ufCode: number | null;
}

const EXPIRING_DAYS_DEFAULT = 30;
const UF_CODE_MAP: Record<string, number> = {
  RO: 11,
  AC: 12,
  AM: 13,
  RR: 14,
  PA: 15,
  AP: 16,
  TO: 17,
  MA: 21,
  PI: 22,
  CE: 23,
  RN: 24,
  PB: 25,
  PE: 26,
  AL: 27,
  SE: 28,
  BA: 29,
  MG: 31,
  ES: 32,
  RJ: 33,
  SP: 35,
  PR: 41,
  SC: 42,
  RS: 43,
  MS: 50,
  MT: 51,
  GO: 52,
  DF: 53,
};

export const BR_UF_CODES = Array.from(new Set(Object.values(UF_CODE_MAP))).sort((a, b) => a - b);

const UF_NAME_TO_SIGLA_MAP: Record<string, string> = {
  RONDONIA: "RO",
  ACRE: "AC",
  AMAZONAS: "AM",
  RORAIMA: "RR",
  PARA: "PA",
  AMAPA: "AP",
  TOCANTINS: "TO",
  MARANHAO: "MA",
  PIAUI: "PI",
  CEARA: "CE",
  RIOGRANDEDONORTE: "RN",
  PARAIBA: "PB",
  PERNAMBUCO: "PE",
  ALAGOAS: "AL",
  SERGIPE: "SE",
  BAHIA: "BA",
  MINASGERAIS: "MG",
  ESPIRITOSANTO: "ES",
  RIODEJANEIRO: "RJ",
  SAOPAULO: "SP",
  PARANA: "PR",
  SANTACATARINA: "SC",
  RIOGRANDEDOSUL: "RS",
  MATOGROSSODOSUL: "MS",
  MATOGROSSO: "MT",
  GOIAS: "GO",
  DISTRITOFEDERAL: "DF",
};

function normalizeUfInput(value: string): string {
  return value
    .trim()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/[^A-Z]/g, "");
}

function resolveUfSigla(raw: string): string | null {
  const normalized = normalizeUfInput(raw);
  if (!normalized) {
    return null;
  }

  if (UF_CODE_MAP[normalized]) {
    return normalized;
  }

  return UF_NAME_TO_SIGLA_MAP[normalized] ?? null;
}

function extractCertificateUf(cert: forge.pki.Certificate): { uf: string | null; ufCode: number | null } {
  const attrs = cert.subject?.attributes ?? [];
  const stateAttr = attrs.find(
    (attr) =>
      attr.shortName === "ST" ||
      attr.name === "stateOrProvinceName" ||
      attr.type === forge.pki.oids.stateOrProvinceName,
  );

  const raw = typeof stateAttr?.value === "string" ? stateAttr.value : "";
  const uf = raw ? resolveUfSigla(raw) : null;
  return {
    uf,
    ufCode: uf ? UF_CODE_MAP[uf] ?? null : null,
  };
}

function diffDaysFromNow(target: Date): number {
  const diffMs = target.getTime() - Date.now();
  return Math.ceil(diffMs / (1000 * 60 * 60 * 24));
}

export function getCertificateStatus(validTo: Date | null | undefined, expiringDays = EXPIRING_DAYS_DEFAULT): CertificateStatus {
  if (!validTo) {
    return "unknown";
  }

  const days = diffDaysFromNow(validTo);
  if (days < 0) {
    return "expired";
  }

  if (days <= expiringDays) {
    return "expiring";
  }

  return "valid";
}

export function getCertificateDaysRemaining(validTo: Date | null | undefined): number | null {
  if (!validTo) {
    return null;
  }

  return diffDaysFromNow(validTo);
}

export function parsePkcs12Certificate(pfxBuffer: Buffer, password: string): ParsedCertificateInfo {
  try {
    const asn1 = forge.asn1.fromDer(forge.util.createBuffer(pfxBuffer.toString("binary")));
    const p12 = forge.pkcs12.pkcs12FromAsn1(asn1, password);

    const certBags = p12.getBags({ bagType: forge.pki.oids.certBag })[forge.pki.oids.certBag] ?? [];
    const keyBags = [
      ...(p12.getBags({ bagType: forge.pki.oids.pkcs8ShroudedKeyBag })[forge.pki.oids.pkcs8ShroudedKeyBag] ?? []),
      ...(p12.getBags({ bagType: forge.pki.oids.keyBag })[forge.pki.oids.keyBag] ?? []),
    ];

    if (keyBags.length === 0) {
      throw new Error("Certificado sem chave privada.");
    }

    const firstCert = certBags.find((bag) => bag.cert)?.cert;
    if (!firstCert) {
      throw new Error("Certificado sem cadeia X509 valida.");
    }

    const notBefore = firstCert.validity?.notBefore ? new Date(firstCert.validity.notBefore) : null;
    const notAfter = firstCert.validity?.notAfter ? new Date(firstCert.validity.notAfter) : null;
    const ufData = extractCertificateUf(firstCert);

    return {
      validFrom: notBefore,
      validTo: notAfter,
      uf: ufData.uf,
      ufCode: ufData.ufCode,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Certificado invalido";
    throw new Error(`Nao foi possivel ler o certificado A1 (.pfx): ${message}`);
  }
}

export function resolveUfCodeFromPfx(pfxBuffer: Buffer, password: string): number | null {
  const parsed = parsePkcs12Certificate(pfxBuffer, password);
  return parsed.ufCode;
}
