import IORedis, { RedisOptions } from "ioredis";
import { env } from "../config/env.js";

let sharedRedis: IORedis | null = null;
let bullmqRedis: IORedis | null = null;

function safeDecodeCredential(value: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }

  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function buildRedisOptionsFromEnv(): RedisOptions {
  const parsed = new URL(env.REDIS_URL);
  const dbRaw = parsed.pathname ? parsed.pathname.replace("/", "") : "";
  const db = dbRaw ? Number(dbRaw) : undefined;

  return {
    host: parsed.hostname,
    port: parsed.port ? Number(parsed.port) : 6379,
    username: safeDecodeCredential(parsed.username) || undefined,
    password: safeDecodeCredential(parsed.password) || undefined,
    db: Number.isFinite(db) ? db : undefined,
    tls: parsed.protocol === "rediss:" ? {} : undefined,
  };
}

export function getRedisClient(): IORedis {
  if (!sharedRedis) {
    sharedRedis = new IORedis({
      ...buildRedisOptionsFromEnv(),
      maxRetriesPerRequest: null,
      enableReadyCheck: true,
      lazyConnect: true,
    });
  }

  return sharedRedis;
}

export function getBullMqConnection(): IORedis {
  if (!bullmqRedis) {
    bullmqRedis = new IORedis({
      ...buildRedisOptionsFromEnv(),
      maxRetriesPerRequest: null,
      enableReadyCheck: true,
      lazyConnect: true,
    });
  }

  return bullmqRedis;
}

export function getBullMqConnectionOptions(): {
  host: string;
  port: number;
  username?: string;
  password?: string;
  db?: number;
  tls?: Record<string, never>;
} {
  const parsed = buildRedisOptionsFromEnv();
  return {
    host: parsed.host ?? "127.0.0.1",
    port: parsed.port ?? 6379,
    username: parsed.username,
    password: parsed.password,
    db: parsed.db,
    tls: parsed.tls ? {} : undefined,
  };
}

export async function disconnectRedisClients(): Promise<void> {
  const closes: Array<Promise<unknown>> = [];

  if (sharedRedis) {
    closes.push(sharedRedis.quit().catch(() => sharedRedis?.disconnect()));
    sharedRedis = null;
  }

  if (bullmqRedis) {
    closes.push(bullmqRedis.quit().catch(() => bullmqRedis?.disconnect()));
    bullmqRedis = null;
  }

  if (closes.length > 0) {
    await Promise.allSettled(closes);
  }
}
