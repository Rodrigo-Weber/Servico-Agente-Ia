import { env } from "../config/env.js";
import { prisma } from "../lib/prisma.js";

const APP_CONFIG_ID = "global";
const CACHE_TTL_MS = 10_000;
const MIN_SYNC_INTERVAL_SECONDS = 3660;

export interface OperationalSettings {
  evolutionBaseUrl: string;
  evolutionApiKey: string;
  evolutionInstanceName: string;
  agentWhatsappNumber: string;
  groqApiKey: string;
  groqModel: string;
  sefazTpAmb: 1 | 2;
  sefazCUFAutor: number;
  sefazNfeDistProdUrl: string;
  sefazNfeDistHomologUrl: string;
  sefazTimeoutMs: number;
  sefazMaxBatchesPerSync: number;
  syncMinIntervalSeconds: number;
}

export interface OperationalSettingsUpdate {
  evolutionBaseUrl?: string | null;
  evolutionApiKey?: string | null;
  evolutionInstanceName?: string | null;
  agentWhatsappNumber?: string | null;
  groqApiKey?: string | null;
  groqModel?: string | null;
  sefazTpAmb?: number | null;
  sefazCUFAutor?: number | null;
  sefazNfeDistProdUrl?: string | null;
  sefazNfeDistHomologUrl?: string | null;
  sefazTimeoutMs?: number | null;
  sefazMaxBatchesPerSync?: number | null;
  syncMinIntervalSeconds?: number | null;
}

function sanitizeNullableString(value: string | null | undefined): string | null | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (value === null) {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function sanitizeNullableNumber(value: number | null | undefined): number | null | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (value === null) {
    return null;
  }

  if (!Number.isFinite(value)) {
    return null;
  }

  return Math.trunc(value);
}

function pickString(value: string | null | undefined, fallback: string): string {
  const normalized = value?.trim();
  if (normalized && normalized.length > 0) {
    return normalized;
  }

  return fallback;
}

function pickNumber(value: number | null | undefined, fallback: number, min: number, max?: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return fallback;
  }

  const normalized = Math.trunc(value);
  if (normalized < min) {
    return fallback;
  }

  if (typeof max === "number" && normalized > max) {
    return fallback;
  }

  return normalized;
}

function resolveTpAmb(value: number | null | undefined, fallback: 1 | 2): 1 | 2 {
  if (value === 1 || value === 2) {
    return value;
  }

  return fallback;
}

interface SettingsCacheState {
  settings: OperationalSettings;
  expiresAt: number;
}

interface DbAppConfigRecord {
  evolutionBaseUrl: string | null;
  evolutionApiKey: string | null;
  evolutionInstanceName: string | null;
  agentWhatsappNumber: string | null;
  groqApiKey: string | null;
  groqModel: string | null;
  sefazTpAmb: number | null;
  sefazCUFAutor: number | null;
  sefazNfeDistProdUrl: string | null;
  sefazNfeDistHomologUrl: string | null;
  sefazTimeoutMs: number | null;
  sefazMaxBatchesPerSync: number | null;
  syncMinIntervalSeconds: number | null;
}

class AppConfigService {
  private cache: SettingsCacheState | null = null;

  private resolve(record: DbAppConfigRecord | null): OperationalSettings {
    return {
      evolutionBaseUrl: pickString(record?.evolutionBaseUrl, env.EVOLUTION_BASE_URL),
      evolutionApiKey: pickString(record?.evolutionApiKey, env.EVOLUTION_API_KEY),
      evolutionInstanceName: pickString(record?.evolutionInstanceName, env.EVOLUTION_INSTANCE_NAME),
      agentWhatsappNumber: pickString(record?.agentWhatsappNumber, env.AGENT_WHATSAPP_NUMBER),
      groqApiKey: pickString(record?.groqApiKey, env.GROQ_API_KEY),
      groqModel: pickString(record?.groqModel, env.GROQ_MODEL),
      sefazTpAmb: resolveTpAmb(record?.sefazTpAmb, env.SEFAZ_TP_AMB as 1 | 2),
      sefazCUFAutor: pickNumber(record?.sefazCUFAutor, env.SEFAZ_CUF_AUTOR, 11, 99),
      sefazNfeDistProdUrl: pickString(record?.sefazNfeDistProdUrl, env.SEFAZ_NFE_DIST_PROD_URL),
      sefazNfeDistHomologUrl: pickString(record?.sefazNfeDistHomologUrl, env.SEFAZ_NFE_DIST_HOMOLOG_URL),
      sefazTimeoutMs: pickNumber(record?.sefazTimeoutMs, env.SEFAZ_TIMEOUT_MS, 1000),
      sefazMaxBatchesPerSync: pickNumber(record?.sefazMaxBatchesPerSync, env.SEFAZ_MAX_BATCHES_PER_SYNC, 1, 30),
      syncMinIntervalSeconds: pickNumber(
        record?.syncMinIntervalSeconds,
        env.SYNC_MIN_INTERVAL_SECONDS,
        MIN_SYNC_INTERVAL_SECONDS,
      ),
    };
  }

  async getSettings(forceRefresh = false): Promise<OperationalSettings> {
    const now = Date.now();
    if (!forceRefresh && this.cache && this.cache.expiresAt > now) {
      return this.cache.settings;
    }

    const config = (await (prisma as any).appConfig.findUnique({
      where: { id: APP_CONFIG_ID },
    })) as DbAppConfigRecord | null;

    const settings = this.resolve(config);
    this.cache = {
      settings,
      expiresAt: now + CACHE_TTL_MS,
    };

    return settings;
  }

  async updateSettings(update: OperationalSettingsUpdate): Promise<OperationalSettings> {
    const data = {
      evolutionBaseUrl: sanitizeNullableString(update.evolutionBaseUrl),
      evolutionApiKey: sanitizeNullableString(update.evolutionApiKey),
      evolutionInstanceName: sanitizeNullableString(update.evolutionInstanceName),
      agentWhatsappNumber: sanitizeNullableString(update.agentWhatsappNumber),
      groqApiKey: sanitizeNullableString(update.groqApiKey),
      groqModel: sanitizeNullableString(update.groqModel),
      sefazTpAmb: sanitizeNullableNumber(update.sefazTpAmb),
      sefazCUFAutor: sanitizeNullableNumber(update.sefazCUFAutor),
      sefazNfeDistProdUrl: sanitizeNullableString(update.sefazNfeDistProdUrl),
      sefazNfeDistHomologUrl: sanitizeNullableString(update.sefazNfeDistHomologUrl),
      sefazTimeoutMs: sanitizeNullableNumber(update.sefazTimeoutMs),
      sefazMaxBatchesPerSync: sanitizeNullableNumber(update.sefazMaxBatchesPerSync),
      syncMinIntervalSeconds: sanitizeNullableNumber(update.syncMinIntervalSeconds),
    };

    await (prisma as any).appConfig.upsert({
      where: { id: APP_CONFIG_ID },
      update: data,
      create: {
        id: APP_CONFIG_ID,
        ...data,
      },
    });

    this.cache = null;
    return this.getSettings(true);
  }
}

export const appConfigService = new AppConfigService();
