import { parseCooldownUntil } from "./sync-status.js";

interface SyncWindowInput {
  minIntervalSeconds: number;
  lastSuccessAt: Date | null | undefined;
  lastSyncAt?: Date | null | undefined;
  status: string | null | undefined;
}

function resolveEffectiveSuccessAt(input: SyncWindowInput): Date | null {
  if (input.lastSuccessAt) {
    return input.lastSuccessAt;
  }

  // Compatibilidade com registros antigos que ainda nao possuem ultimoSucessoAt.
  const normalizedStatus = (input.status ?? "").toLowerCase();
  if (input.lastSyncAt && normalizedStatus.startsWith("success")) {
    return input.lastSyncAt;
  }

  return null;
}

function getIntervalUntil(lastSuccessAt: Date | null, minIntervalSeconds: number): Date | null {
  if (!lastSuccessAt) {
    return null;
  }

  return new Date(lastSuccessAt.getTime() + minIntervalSeconds * 1000);
}

export function getNextAllowedSyncAt(input: SyncWindowInput): Date | null {
  const intervalUntil = getIntervalUntil(resolveEffectiveSuccessAt(input), input.minIntervalSeconds);
  const cooldownUntil = parseCooldownUntil(input.status);

  if (!intervalUntil && !cooldownUntil) {
    return null;
  }

  if (intervalUntil && cooldownUntil) {
    return intervalUntil.getTime() > cooldownUntil.getTime() ? intervalUntil : cooldownUntil;
  }

  return intervalUntil ?? cooldownUntil ?? null;
}

export function getNextSyncWaitSeconds(input: SyncWindowInput, now = new Date()): number | null {
  const nextAllowed = getNextAllowedSyncAt(input);
  if (!nextAllowed) {
    return null;
  }

  const diffMs = nextAllowed.getTime() - now.getTime();
  if (diffMs <= 0) {
    return 0;
  }

  return Math.ceil(diffMs / 1000);
}

export function isSyncBlocked(input: SyncWindowInput, now = new Date()): boolean {
  const waitSeconds = getNextSyncWaitSeconds(input, now);
  return (waitSeconds ?? 0) > 0;
}
