import { z } from "zod";

const boolishSchema = z.union([z.string(), z.boolean(), z.undefined()]).transform((value) => {
  if (typeof value === "boolean") {
    return value;
  }

  if (typeof value !== "string") {
    return false;
  }

  const normalized = value.trim().toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes" || normalized === "on";
});

const logLevelSchema = z.enum(["fatal", "error", "warn", "info", "debug", "trace"]);
const sefazUfCodes = [11, 12, 13, 14, 15, 16, 17, 21, 22, 23, 24, 25, 26, 27, 28, 29, 31, 32, 33, 35, 41, 42, 43, 50, 51, 52, 53] as const;
const sefazTpAmbSchema = z
  .coerce.number()
  .int()
  .refine((value) => value === 1 || value === 2, {
    message: "SEFAZ_TP_AMB deve ser 1 (producao) ou 2 (homologacao)",
  });
const sefazCUFAutorSchema = z
  .coerce.number()
  .int()
  .refine((value) => (sefazUfCodes as readonly number[]).includes(value), {
    message: "SEFAZ_CUF_AUTOR deve ser o codigo IBGE da UF (ex.: 29 BA, 35 SP, 41 PR)",
  });

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().default(3333),
  LOG_LEVEL: logLevelSchema.default("warn"),
  LOG_REQUESTS: boolishSchema.default(false),
  DATABASE_URL: z.string().min(1),
  JWT_ACCESS_SECRET: z.string().min(8),
  JWT_REFRESH_SECRET: z.string().min(8),
  ACCESS_TOKEN_EXPIRES_IN: z.string().default("1h"),
  REFRESH_TOKEN_EXPIRES_IN_DAYS: z.coerce.number().int().positive().default(30),
  APP_ENCRYPTION_KEY: z.string().min(8),
  EVOLUTION_BASE_URL: z.string().url().default("http://localhost:8080"),
  EVOLUTION_API_KEY: z.string().optional().default(""),
  EVOLUTION_INSTANCE_NAME: z.string().default("agente_nfe"),
  SEFAZ_TP_AMB: sefazTpAmbSchema.default(1),
  SEFAZ_CUF_AUTOR: sefazCUFAutorSchema.default(35),
  SEFAZ_NFE_DIST_PROD_URL: z.string().url().default("https://www1.nfe.fazenda.gov.br/NFeDistribuicaoDFe/NFeDistribuicaoDFe.asmx"),
  SEFAZ_NFE_DIST_HOMOLOG_URL: z.string().url().default("https://hom1.nfe.fazenda.gov.br/NFeDistribuicaoDFe/NFeDistribuicaoDFe.asmx"),
  SEFAZ_TIMEOUT_MS: z.coerce.number().int().positive().default(30000),
  SEFAZ_MAX_BATCHES_PER_SYNC: z.coerce.number().int().positive().max(30).default(5),
  SYNC_MIN_INTERVAL_SECONDS: z.coerce.number().int().positive().default(3660),
  AGENT_WHATSAPP_NUMBER: z.string().optional().default(""),
  GROQ_API_KEY: z.string().optional().default(""),
  GROQ_MODEL: z.string().default("llama-3.1-8b-instant"),
  REDIS_URL: z.string().url().default("redis://127.0.0.1:6379"),
  QUEUE_OUTBOUND_ENABLED: boolishSchema.default(false),
  RATE_LIMIT_ENABLED: boolishSchema.default(false),
  WEBHOOK_FAST_ACK_ENABLED: boolishSchema.default(false),
  ENABLE_MESSAGE_WORKER: boolishSchema.default(false),
  ENABLE_EMBEDDED_WORKER: boolishSchema.default(false),
  SERVE_WEB_STATIC: boolishSchema.default(false),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error("Variaveis de ambiente invalidas", parsed.error.flatten().fieldErrors);
  throw new Error("Falha ao carregar .env");
}

export const env = parsed.data;
