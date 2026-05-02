/**
 * TOTP (Time-based One-Time Password) implementation — RFC 6238 / RFC 4226
 * Uses only Node.js built-in crypto (no external dependencies).
 */
import { createHmac, randomBytes } from "crypto";
import { encryptSecret, decryptSecret } from "./cryptoUtils";

const BASE32_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export function generateBase32Secret(byteLength = 20): string {
  const bytes = randomBytes(byteLength);
  let result = "";
  let bits = 0;
  let value = 0;
  for (let i = 0; i < bytes.length; i++) {
    value = (value << 8) | bytes[i];
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      result += BASE32_CHARS[(value >> bits) & 0x1f];
    }
  }
  if (bits > 0) result += BASE32_CHARS[(value << (5 - bits)) & 0x1f];
  return result;
}

function base32Decode(encoded: string): Buffer {
  const clean = encoded.toUpperCase().replace(/[=\s]/g, "");
  let bits = 0;
  let value = 0;
  const output: number[] = [];
  for (const char of clean) {
    const idx = BASE32_CHARS.indexOf(char);
    if (idx === -1) continue;
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      output.push((value >> bits) & 0xff);
    }
  }
  return Buffer.from(output);
}

function hotp(secret: string, counter: number): string {
  const key = base32Decode(secret);
  const buf = Buffer.alloc(8);
  // Write counter as big-endian 64-bit integer
  const high = Math.floor(counter / 0x100000000);
  const low = counter >>> 0;
  buf.writeUInt32BE(high, 0);
  buf.writeUInt32BE(low, 4);
  const hmac = createHmac("sha1", key).update(buf).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const code =
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff);
  return (code % 1000000).toString().padStart(6, "0");
}

const STEP_SECONDS = 30;
const WINDOW = 1; // allow ±1 time step drift

export function generateTOTP(secret: string, atMs = Date.now()): string {
  const counter = Math.floor(atMs / 1000 / STEP_SECONDS);
  return hotp(secret, counter);
}

export function verifyTOTP(secret: string, token: string, atMs = Date.now()): boolean {
  const counter = Math.floor(atMs / 1000 / STEP_SECONDS);
  for (let delta = -WINDOW; delta <= WINDOW; delta++) {
    if (hotp(secret, counter + delta) === token.replace(/\s/g, "")) {
      return true;
    }
  }
  return false;
}

export function buildOtpAuthUri(secret: string, accountName: string, issuer = "PayLink"): string {
  const enc = encodeURIComponent;
  return `otpauth://totp/${enc(issuer)}:${enc(accountName)}?secret=${secret}&issuer=${enc(issuer)}&algorithm=SHA1&digits=6&period=30`;
}

export function encryptTotpSecret(plainSecret: string): string {
  return encryptSecret(plainSecret);
}

export function decryptTotpSecret(encrypted: string): string | null {
  return decryptSecret(encrypted);
}
