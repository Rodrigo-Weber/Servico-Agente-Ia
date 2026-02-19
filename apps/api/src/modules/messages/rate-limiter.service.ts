import { prisma } from "../../lib/prisma.js";
import { getRedisClient } from "../../lib/redis.js";
import { env } from "../../config/env.js";

type PolicyScope = "global" | "instance" | "company" | "contact";

interface EffectivePolicy {
  scope: PolicyScope;
  key: string;
  maxPerMinute: number;
  minDelayMs: number;
  maxDelayMs: number;
}

interface CacheState {
  expiresAt: number;
  policies: EffectivePolicy[];
}

const CACHE_TTL_MS = 10_000;
let policyCache: CacheState | null = null;

function minuteWindowKey(prefix: string): string {
  const now = new Date();
  const minuteBucket = `${now.getUTCFullYear()}${String(now.getUTCMonth() + 1).padStart(2, "0")}${String(
    now.getUTCDate(),
  ).padStart(2, "0")}${String(now.getUTCHours()).padStart(2, "0")}${String(now.getUTCMinutes()).padStart(2, "0")}`;
  return `${prefix}:${minuteBucket}`;
}

function dayWindowKey(prefix: string): string {
  const now = new Date();
  const dayBucket = `${now.getUTCFullYear()}${String(now.getUTCMonth() + 1).padStart(2, "0")}${String(
    now.getUTCDate(),
  ).padStart(2, "0")}`;
  return `${prefix}:${dayBucket}`;
}

function jitter(minDelayMs: number, maxDelayMs: number): number {
  const min = Math.max(0, Math.trunc(minDelayMs));
  const max = Math.max(min, Math.trunc(maxDelayMs));
  if (max <= min) {
    return min;
  }

  return min + Math.floor(Math.random() * (max - min + 1));
}

async function buildEffectivePolicies(input: {
  companyId: string;
  instanceName: string;
  phone: string;
}): Promise<EffectivePolicy[]> {
  const now = Date.now();
  if (policyCache && policyCache.expiresAt > now) {
    return policyCache.policies.map((policy) => {
      if (policy.scope === "instance") {
        return { ...policy, key: `rl:instance:${input.instanceName}` };
      }

      if (policy.scope === "company") {
        return { ...policy, key: `rl:company:${input.companyId}` };
      }

      if (policy.scope === "contact") {
        return { ...policy, key: `rl:contact:${input.companyId}:${input.phone}` };
      }

      return policy;
    });
  }

  const dbPolicies = await prisma.rateLimitPolicy.findMany({
    where: { active: true },
    orderBy: { createdAt: "asc" },
    select: {
      scope: true,
      instanceName: true,
      companyId: true,
      maxPerMinute: true,
      minDelayMs: true,
      maxDelayMs: true,
    },
  });

  const normalized = dbPolicies
    .map((policy) => policy.scope as PolicyScope)
    .filter((scope): scope is PolicyScope => scope === "global" || scope === "instance" || scope === "company" || scope === "contact");

  const hasGlobal = normalized.includes("global");
  const hasInstance = normalized.includes("instance");
  const hasCompany = normalized.includes("company");
  const hasContact = normalized.includes("contact");

  const defaults: EffectivePolicy[] = [
    {
      scope: "global",
      key: "rl:global",
      maxPerMinute: 200,
      minDelayMs: 1500,
      maxDelayMs: 4500,
    },
    {
      scope: "instance",
      key: `rl:instance:${input.instanceName}`,
      maxPerMinute: 20,
      minDelayMs: 1500,
      maxDelayMs: 4500,
    },
    {
      scope: "company",
      key: `rl:company:${input.companyId}`,
      maxPerMinute: 12,
      minDelayMs: 1500,
      maxDelayMs: 4500,
    },
    {
      scope: "contact",
      key: `rl:contact:${input.companyId}:${input.phone}`,
      maxPerMinute: 3,
      minDelayMs: 1500,
      maxDelayMs: 4500,
    },
  ];

  const resolved: EffectivePolicy[] = [];

  for (const policy of dbPolicies) {
    const scope = policy.scope as PolicyScope;
    if (scope !== "global" && scope !== "instance" && scope !== "company" && scope !== "contact") {
      continue;
    }

    if (scope === "instance" && policy.instanceName && policy.instanceName !== input.instanceName) {
      continue;
    }

    if ((scope === "company" || scope === "contact") && policy.companyId && policy.companyId !== input.companyId) {
      continue;
    }

    let key = "rl:global";
    if (scope === "instance") {
      key = `rl:instance:${input.instanceName}`;
    } else if (scope === "company") {
      key = `rl:company:${input.companyId}`;
    } else if (scope === "contact") {
      key = `rl:contact:${input.companyId}:${input.phone}`;
    }

    resolved.push({
      scope,
      key,
      maxPerMinute: Math.max(1, Math.trunc(policy.maxPerMinute)),
      minDelayMs: Math.max(0, Math.trunc(policy.minDelayMs)),
      maxDelayMs: Math.max(Math.trunc(policy.minDelayMs), Math.trunc(policy.maxDelayMs)),
    });
  }

  if (!hasGlobal) {
    resolved.push(defaults[0]!);
  }
  if (!hasInstance) {
    resolved.push(defaults[1]!);
  }
  if (!hasCompany) {
    resolved.push(defaults[2]!);
  }
  if (!hasContact) {
    resolved.push(defaults[3]!);
  }

  policyCache = {
    policies: resolved,
    expiresAt: now + CACHE_TTL_MS,
  };

  return resolved;
}

export interface DispatchRateLimitResult {
  delayMs: number;
  reason?: string;
}

class DispatchRateLimiterService {
  async reserveSlot(input: {
    companyId: string;
    instanceName: string;
    phone: string;
  }): Promise<DispatchRateLimitResult> {
    if (!env.RATE_LIMIT_ENABLED) {
      return { delayMs: 0 };
    }

    const redis = getRedisClient();

    try {
      const [policies, companyLimit] = await Promise.all([
        buildEffectivePolicies(input),
        prisma.companyOperationalLimit.findUnique({
          where: { companyId: input.companyId },
          select: { active: true, dailyOutboundCap: true },
        }),
      ]);

      let minDelayMs = 0;
      let maxDelayMs = 0;
      let blockedForMs = 0;

      for (const policy of policies) {
        minDelayMs = Math.max(minDelayMs, policy.minDelayMs);
        maxDelayMs = Math.max(maxDelayMs, policy.maxDelayMs);

        const key = minuteWindowKey(policy.key);
        const count = await redis.incr(key);
        if (count === 1) {
          await redis.expire(key, 65);
        }

        if (count > policy.maxPerMinute) {
          const ttlMs = await redis.pttl(key);
          blockedForMs = Math.max(blockedForMs, ttlMs > 0 ? ttlMs : 1_000);
        }
      }

      const effectiveDailyCap = companyLimit?.active === false ? null : companyLimit?.dailyOutboundCap ?? 500;
      if (effectiveDailyCap !== null) {
        const dayKey = dayWindowKey(`rl:day:${input.companyId}`);
        const currentDayCount = Number((await redis.get(dayKey)) || "0");
        if (currentDayCount >= effectiveDailyCap) {
          return {
            delayMs: 60_000,
            reason: "daily_cap",
          };
        }
      }

      if (blockedForMs > 0) {
        const randomDelay = jitter(minDelayMs, maxDelayMs || minDelayMs);
        return { delayMs: blockedForMs + randomDelay, reason: "minute_cap" };
      }

      return { delayMs: 0 };
    } catch {
      return { delayMs: 0, reason: "rate_limit_unavailable" };
    }
  }

  async markSent(companyId: string): Promise<void> {
    try {
      const redis = getRedisClient();
      const dayKey = dayWindowKey(`rl:day:${companyId}`);
      const count = await redis.incr(dayKey);
      if (count === 1) {
        await redis.expire(dayKey, 60 * 60 * 30);
      }
    } catch {
      // Falha de Redis nao deve derrubar o fluxo de envio.
    }
  }
}

export const dispatchRateLimiterService = new DispatchRateLimiterService();
