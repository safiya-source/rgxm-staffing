// Encryption for Social Insurance Numbers (needed on T4A slips). AES-256-GCM with a dedicated key
// (TAX_ID_ENCRYPTION_KEY, 32 random bytes in base64), so a copy of the database alone doesn't reveal
// anyone's SIN. Plain SINs are never stored, logged or sent to the browser after entry.
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { env } from "@/server/env";

const VERSION = "v1";

export class TaxIdError extends Error {}

function key() {
  const raw = env.TAX_ID_ENCRYPTION_KEY;
  if (!raw) throw new TaxIdError("SIN storage isn't set up yet. An administrator needs to add TAX_ID_ENCRYPTION_KEY (see docs/GO_LIVE.md).");
  const k = Buffer.from(raw, "base64");
  if (k.length !== 32) throw new TaxIdError("TAX_ID_ENCRYPTION_KEY must be 32 bytes, base64-encoded (openssl rand -base64 32).");
  return k;
}

export const taxIdStorageReady = () => {
  try {
    key();
    return true;
  } catch {
    return false;
  }
};

/** Digits only, validated with the Luhn check every SIN satisfies. Returns null when invalid. */
export function normalizeSin(input: string): string | null {
  const digits = input.replace(/[\s-]/g, "");
  if (!/^\d{9}$/.test(digits) || /^0/.test(digits)) return null;
  let sum = 0;
  for (let i = 0; i < 9; i++) {
    let d = Number(digits[i]);
    if (i % 2 === 1) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
  }
  return sum % 10 === 0 ? digits : null;
}

export function encryptSin(sin: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const ct = Buffer.concat([cipher.update(sin, "utf8"), cipher.final()]);
  return [VERSION, iv.toString("base64"), cipher.getAuthTag().toString("base64"), ct.toString("base64")].join(":");
}

export function decryptSin(stored: string) {
  const [version, iv, tag, ct] = stored.split(":");
  if (version !== VERSION || !iv || !tag || !ct) throw new TaxIdError("Unrecognised SIN format.");
  const decipher = createDecipheriv("aes-256-gcm", key(), Buffer.from(iv, "base64"));
  decipher.setAuthTag(Buffer.from(tag, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(ct, "base64")), decipher.final()]).toString("utf8");
}

/** "123 456 789" for slips. */
export const formatSin = (sin: string) => `${sin.slice(0, 3)} ${sin.slice(3, 6)} ${sin.slice(6)}`;
