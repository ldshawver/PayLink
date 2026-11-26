/**
 * Private personnel document store.
 *
 * - Files live in PRIVATE_DOCUMENT_DIR (never under /uploads, never served
 *   statically, no URL). Name on disk = the random document id + ".bin".
 * - Contents are encrypted with AES-256-GCM. Key: PRIVATE_DOCUMENT_ENCRYPTION_KEY
 *   (base64, 32 bytes). Previous keys for rotation: PRIVATE_DOCUMENT_ENCRYPTION_KEYS_PREVIOUS
 *   (comma-separated base64). The key id stored with each file is a hash prefix
 *   of the key, never the key.
 * - The GCM additional data binds the ciphertext to (document id, company id,
 *   worker id, kind): a file copied onto another record does not decrypt.
 * - Missing key or directory → not configured; callers refuse uploads/downloads.
 *
 * Nothing here logs file contents, names or values.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export const PRIVATE_DOC_MAX_BYTES = 10 * 1024 * 1024;

type Key = { id: string; key: Buffer };
const keyId = (key: Buffer) => crypto.createHash("sha256").update(key).digest("hex").slice(0, 16);

function parseKey(b64: string): Buffer | null {
  try {
    const k = Buffer.from(b64.trim(), "base64");
    return k.length === 32 ? k : null;
  } catch { return null; }
}

export function loadKeys(env: NodeJS.ProcessEnv = process.env): { current: Key | null; all: Key[] } {
  const cur = env.PRIVATE_DOCUMENT_ENCRYPTION_KEY ? parseKey(env.PRIVATE_DOCUMENT_ENCRYPTION_KEY) : null;
  const prev = (env.PRIVATE_DOCUMENT_ENCRYPTION_KEYS_PREVIOUS || "").split(",").map((s) => s.trim()).filter(Boolean)
    .map(parseKey).filter((k): k is Buffer => !!k);
  const all = [...(cur ? [cur] : []), ...prev].map((key) => ({ id: keyId(key), key }));
  return { current: cur ? { id: keyId(cur), key: cur } : null, all };
}

export function storeDir(env: NodeJS.ProcessEnv = process.env): string | null {
  const d = (env.PRIVATE_DOCUMENT_DIR || "").trim();
  if (!d || !path.isAbsolute(d)) return null;
  return path.resolve(d);
}

export type StoreStatus = { ok: true } | { ok: false; reason: "no_key" | "no_dir" | "dir_unwritable" | "dir_public" };

/** Configured = a valid 32-byte key + an absolute, writable directory outside the public uploads folder. */
export function storeStatus(env: NodeJS.ProcessEnv = process.env): StoreStatus {
  if (!loadKeys(env).current) return { ok: false, reason: "no_key" };
  const dir = storeDir(env);
  if (!dir) return { ok: false, reason: "no_dir" };
  const uploads = path.resolve(process.cwd(), "uploads");
  if (dir === uploads || dir.startsWith(uploads + path.sep)) return { ok: false, reason: "dir_public" };
  try {
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    fs.accessSync(dir, fs.constants.W_OK | fs.constants.R_OK);
  } catch { return { ok: false, reason: "dir_unwritable" }; }
  return { ok: true };
}

export const STORE_STATUS_MESSAGE: Record<Exclude<StoreStatus, { ok: true }>["reason"], string> = {
  no_key: "Private document storage is not configured on this server (encryption key missing). Ask a platform administrator to set it up.",
  no_dir: "Private document storage is not configured on this server (storage folder missing). Ask a platform administrator to set it up.",
  dir_unwritable: "Private document storage is unavailable (storage folder not writable). Ask a platform administrator to check it.",
  dir_public: "Private document storage is misconfigured (folder is inside public uploads). Ask a platform administrator to fix it.",
};

export type Detected = { mime: "image/jpeg" | "image/png" | "application/pdf" | "image/heic"; ext: string };
/** Type from the file's own bytes; the client's name and Content-Type are ignored. */
export function detectType(buf: Buffer): Detected | null {
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return { mime: "image/jpeg", ext: "jpg" };
  if (buf.length >= 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return { mime: "image/png", ext: "png" };
  if (buf.length >= 5 && buf.subarray(0, 5).toString("latin1") === "%PDF-") return { mime: "application/pdf", ext: "pdf" };
  if (buf.length >= 12 && buf.subarray(4, 8).toString("latin1") === "ftyp" && /^(heic|heix|mif1|msf1)$/.test(buf.subarray(8, 12).toString("latin1"))) return { mime: "image/heic", ext: "heic" };
  return null;
}

export type Binding = { documentId: string; companyId: string; workerId: string; kind: string };
const aad = (b: Binding) => Buffer.from(`ppd:v1:${b.documentId}:${b.companyId}:${b.workerId}:${b.kind}`, "utf8");
const filePath = (dir: string, documentId: string) => {
  if (!/^[0-9a-f-]{36}$/.test(documentId)) throw new Error("invalid document id");
  return path.join(dir, `${documentId}.bin`);
};

export type Sealed = { keyId: string; iv: string; tag: string; ciphertextSha256: string; size: number };

/** Encrypt and write atomically (temp file → fsync → rename). Never overwrites an existing file. */
export function sealAndWrite(plain: Buffer, b: Binding, env: NodeJS.ProcessEnv = process.env): Sealed {
  const { current } = loadKeys(env);
  const dir = storeDir(env);
  if (!current || !dir) throw new Error("private document store not configured");
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv("aes-256-gcm", current.key, iv);
  c.setAAD(aad(b));
  const ct = Buffer.concat([c.update(plain), c.final()]);
  const tag = c.getAuthTag();
  const dest = filePath(dir, b.documentId);
  const tmp = `${dest}.${crypto.randomBytes(6).toString("hex")}.tmp`;
  const fd = fs.openSync(tmp, "wx", 0o600);
  try { fs.writeSync(fd, ct); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  if (fs.existsSync(dest)) { fs.unlinkSync(tmp); throw new Error("refusing to overwrite an existing private document"); }
  fs.renameSync(tmp, dest);
  return { keyId: current.id, iv: iv.toString("base64"), tag: tag.toString("base64"), ciphertextSha256: crypto.createHash("sha256").update(ct).digest("hex"), size: plain.length };
}

/** Read, verify checksum and decrypt. Throws on any mismatch (wrong record, tampering, unknown key). */
export function readAndOpen(b: Binding, meta: { keyId: string; iv: string; tag: string; ciphertextSha256: string }, env: NodeJS.ProcessEnv = process.env): Buffer {
  const dir = storeDir(env);
  if (!dir) throw new Error("private document store not configured");
  const key = loadKeys(env).all.find((k) => k.id === meta.keyId);
  if (!key) throw new Error("encryption key for this document is not available");
  const ct = fs.readFileSync(filePath(dir, b.documentId));
  if (crypto.createHash("sha256").update(ct).digest("hex") !== meta.ciphertextSha256) throw new Error("private document checksum mismatch");
  const d = crypto.createDecipheriv("aes-256-gcm", key.key, Buffer.from(meta.iv, "base64"));
  d.setAAD(aad(b));
  d.setAuthTag(Buffer.from(meta.tag, "base64"));
  return Buffer.concat([d.update(ct), d.final()]);
}

/** Remove a file written for a record whose database insert then failed. */
export function discard(documentId: string, env: NodeJS.ProcessEnv = process.env): void {
  const dir = storeDir(env);
  if (!dir) return;
  try { fs.unlinkSync(filePath(dir, documentId)); } catch { /* already gone */ }
}
