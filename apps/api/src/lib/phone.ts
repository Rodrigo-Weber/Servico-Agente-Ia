export function normalizePhone(raw: string): string {
  return raw.replace(/\D/g, "");
}
