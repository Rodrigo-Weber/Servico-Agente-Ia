import crypto from "node:crypto";
import { env } from "../config/env.js";

function getKey(): Buffer {
  if (/^[0-9a-fA-F]{64}$/.test(env.APP_ENCRYPTION_KEY)) {
    return Buffer.from(env.APP_ENCRYPTION_KEY, "hex");
  }

  return crypto.createHash("sha256").update(env.APP_ENCRYPTION_KEY, "utf8").digest();
}

const key = getKey();

export function encryptBuffer(data: Buffer): Buffer {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(data), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, encrypted]);
}

export function decryptBuffer(payload: Buffer): Buffer {
  const iv = payload.subarray(0, 12);
  const tag = payload.subarray(12, 28);
  const encrypted = payload.subarray(28);
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(encrypted), decipher.final()]);
}

export function encryptText(text: string): Buffer {
  return encryptBuffer(Buffer.from(text, "utf8"));
}

export function decryptText(payload: Buffer): string {
  return decryptBuffer(payload).toString("utf8");
}
