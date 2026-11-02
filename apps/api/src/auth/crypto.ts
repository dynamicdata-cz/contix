import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

export const randomToken = (bytes = 32) => randomBytes(bytes).toString("base64url");
export const sha256 = (v: string) => createHash("sha256").update(v).digest("hex");

/* ---------- AES-256-GCM pro tajemství v DB ---------- */

const keyFrom = (secret: string) => createHash("sha256").update(`contix:enc:${secret}`).digest();

export function encrypt(plain: string, secret: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", keyFrom(secret), iv);
  const enc = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return ["v1", iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), enc.toString("base64url")].join(".");
}

export function decrypt(payload: string, secret: string): string {
  const [v, iv, tag, enc] = payload.split(".");
  if (v !== "v1" || !iv || !tag || !enc) throw new Error("Neplatný šifrovaný údaj");
  const d = createDecipheriv("aes-256-gcm", keyFrom(secret), Buffer.from(iv, "base64url"));
  d.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([d.update(Buffer.from(enc, "base64url")), d.final()]).toString("utf8");
}

/* ---------- Base32 (RFC 4648) ---------- */

const B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export function base32Encode(buf: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = "";
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += B32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(s: string): Buffer {
  const clean = s.toUpperCase().replace(/[^A-Z2-7]/g, "");
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of clean) {
    value = (value << 5) | B32.indexOf(ch);
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

/* ---------- TOTP (RFC 6238, SHA-1, 6 číslic, 30 s) ---------- */

export const TOTP_PERIOD = 30;

export function generateTotpSecret(): string {
  return base32Encode(randomBytes(20));
}

export function totpAt(secret: string, step: number): string {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));
  const h = createHmac("sha1", base32Decode(secret)).update(counter).digest();
  const offset = h[h.length - 1]! & 0xf;
  const code = (h.readUInt32BE(offset) & 0x7fffffff) % 1_000_000;
  return code.toString().padStart(6, "0");
}

/** Vrátí použitý krok (pro ochranu proti replay), nebo null. Tolerance ±1 krok (hodiny telefonu). */
export function verifyTotp(secret: string, code: string, now = Date.now(), lastStep?: number | null): number | null {
  const c = code.replace(/\s/g, "");
  if (!/^\d{6}$/.test(c)) return null;
  const current = Math.floor(now / 1000 / TOTP_PERIOD);
  for (const step of [current - 1, current, current + 1]) {
    if (lastStep != null && step <= lastStep) continue;
    const expected = totpAt(secret, step);
    if (timingSafeEqual(Buffer.from(expected), Buffer.from(c))) return step;
  }
  return null;
}

export function otpauthUrl(secret: string, account: string, issuer = "CONTIX"): string {
  const label = encodeURIComponent(`${issuer}:${account}`);
  return `otpauth://totp/${label}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=${TOTP_PERIOD}`;
}

/** Záložní kódy ve tvaru xxxx-xxxx (bez zaměnitelných znaků). */
export function generateRecoveryCodes(n = 10): string[] {
  const alphabet = "abcdefghjkmnpqrstuvwxyz23456789";
  return Array.from({ length: n }, () => {
    const b = randomBytes(8);
    const s = [...b].map((x) => alphabet[x % alphabet.length]).join("");
    return `${s.slice(0, 4)}-${s.slice(4)}`;
  });
}

export const normalizeRecoveryCode = (c: string) => c.trim().toLowerCase().replace(/[^a-z0-9]/g, "");
