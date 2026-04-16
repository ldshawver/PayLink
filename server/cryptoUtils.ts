import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "crypto";

const ALGO = "aes-256-gcm";
const SALT = "paylink-cfg-salt-v1";
const DEV_FALLBACK = "paylink-dev-only-not-for-production!!";

function getSecret(): string {
  const secret = process.env.SESSION_SECRET || process.env.APP_SECRET;
  if (!secret) {
    if (process.env.NODE_ENV === "production") {
      throw new Error(
        "SESSION_SECRET is not set. Credential encryption is disabled in production until a strong secret is configured. " +
        "Set the SESSION_SECRET environment variable to a random 32+ character string before storing SMTP or SMS credentials."
      );
    }
    return DEV_FALLBACK;
  }
  return secret;
}

function getDerivedKey(): Buffer {
  return scryptSync(getSecret(), SALT, 32);
}

/**
 * Returns true if a proper secret is configured (safe to encrypt credentials).
 * In production, returns false when SESSION_SECRET is absent.
 */
export function isEncryptionAvailable(): boolean {
  const secret = process.env.SESSION_SECRET || process.env.APP_SECRET;
  return !!(secret) || process.env.NODE_ENV !== "production";
}

/**
 * Encrypt a plaintext string using AES-256-GCM (authenticated encryption).
 * Returns a hex string in the format: iv:authTag:ciphertext
 * Throws in production if SESSION_SECRET / APP_SECRET is not set.
 */
export function encryptSecret(plaintext: string): string {
  const key = getDerivedKey();
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGO, key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return [iv.toString("hex"), authTag.toString("hex"), encrypted.toString("hex")].join(":");
}

/**
 * Decrypt a ciphertext string produced by encryptSecret.
 * Returns null if decryption fails (wrong key, tampered ciphertext, invalid format).
 */
export function decryptSecret(ciphertext: string): string | null {
  try {
    const parts = ciphertext.split(":");
    if (parts.length !== 3) return null;
    const [ivHex, authTagHex, encHex] = parts;
    const key = getDerivedKey();
    const iv = Buffer.from(ivHex, "hex");
    const authTag = Buffer.from(authTagHex, "hex");
    const encrypted = Buffer.from(encHex, "hex");
    const decipher = createDecipheriv(ALGO, key, iv);
    decipher.setAuthTag(authTag);
    const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);
    return decrypted.toString("utf8");
  } catch {
    return null;
  }
}
