export type UserRole = "admin" | "company";

export type CompanyAiType = "nfe_import";

export type NfeStatus = "detected" | "imported" | "failed";

export type IntentType = "ver" | "importar" | "ver_e_importar" | "ajuda";

export const DEFAULT_COMPANY_AI_TYPE: CompanyAiType = "nfe_import";
