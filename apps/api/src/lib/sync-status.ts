const COOLDOWN_PREFIX = "cooldown_until:";
const REASON_SEPARATOR = "|";

export function buildCooldownStatus(until: Date, reason = "656"): string {
  return `${COOLDOWN_PREFIX}${until.toISOString()}${REASON_SEPARATOR}reason:${reason}`;
}

export function parseCooldownUntil(status: string | null | undefined): Date | null {
  if (!status || typeof status !== "string") {
    return null;
  }

  const normalized = status.trim();
  if (!normalized.startsWith(COOLDOWN_PREFIX)) {
    return null;
  }

  const payload = normalized.slice(COOLDOWN_PREFIX.length);
  const iso = payload.split(REASON_SEPARATOR)[0]?.trim() ?? "";
  if (!iso) {
    return null;
  }

  const parsed = new Date(iso);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function isCooldownActive(status: string | null | undefined, now = new Date()): boolean {
  const until = parseCooldownUntil(status);
  if (!until) {
    return false;
  }

  return until.getTime() > now.getTime();
}

export function getCooldownRemainingSeconds(status: string | null | undefined, now = new Date()): number | null {
  const until = parseCooldownUntil(status);
  if (!until) {
    return null;
  }

  const diffMs = until.getTime() - now.getTime();
  if (diffMs <= 0) {
    return 0;
  }

  return Math.ceil(diffMs / 1000);
}

