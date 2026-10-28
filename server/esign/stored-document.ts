/**
 * Server-side read of a stored upload for e-sign providers.
 *
 * Provider adapters receive the document BYTES. They used to receive a URL —
 * the proposal flow passed `${baseUrl}/uploads/<file>` and the adapter fetched
 * it over HTTP from this same app, which only worked while /uploads was served
 * anonymously (and let any http(s) URL be fetched server-side). Now the route
 * resolves the stored reference to a file inside the uploads root with the
 * same normalization and symlink refusal as GET /uploads.
 */
import fs from "fs";
import { normalizeUploadRequestPath, resolveUploadFileStrict } from "../auth/upload-access-guard";

/**
 * Bytes of a stored "/uploads/<rel>" (or legacy "uploads/<rel>") reference, or
 * null when the value is not a local upload (external URLs included), escapes
 * the root, traverses a symlink, or the file is missing.
 */
export async function readStoredUploadForDelivery(
  fileUrl: string | null | undefined,
  uploadsDir: string,
): Promise<Buffer | null> {
  if (typeof fileUrl !== "string") return null;
  const m = /^\/?uploads\/(.+)$/.exec(fileUrl.split("?")[0]);
  if (!m) return null;
  const ref = normalizeUploadRequestPath(m[1]);
  if (!ref) return null;
  const abs = await resolveUploadFileStrict(uploadsDir, ref.rel, fs.promises);
  return abs ? fs.promises.readFile(abs) : null;
}
