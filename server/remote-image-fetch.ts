/**
 * SSRF-safe remote image fetch for check-face logo rendering (company/bank
 * logo URLs configured per tenant). Extracted from renderCheckPdf() in
 * server/routes.ts — same rationale as server/check-micr.ts — so the exact
 * IP-classification and redirect-handling logic the renderer relies on can be
 * imported by a regression test without booting the app or a database.
 *
 * Guarantees:
 *  - Only http:// and https:// URLs are fetched.
 *  - Every hostname (the initial URL and each of up to 3 redirect hops) must
 *    resolve to a public IP. Loopback, RFC1918 private ranges, link-local
 *    (including the 169.254.169.254 cloud-metadata address), and other
 *    non-public ranges are rejected.
 *  - The resolved address is pinned via a custom `dns.lookup` passed to the
 *    request, so the connection cannot be re-resolved to a different
 *    (rebound) address after validation (DNS-rebinding TOCTOU).
 *  - Response size is capped; total wall-clock time across all redirect hops
 *    is bounded.
 */
import net from "net";

export const REMOTE_IMAGE_MAX_BYTES = 5 * 1024 * 1024;
export const REMOTE_IMAGE_MAX_REDIRECTS = 3;
export const REMOTE_IMAGE_PER_HOP_TIMEOUT_MS = 8000;
export const REMOTE_IMAGE_TOTAL_TIMEOUT_MS = 15000;

export function isDisallowedRemoteImageIp(ip: string): boolean {
  if (net.isIPv4(ip)) {
    const parts = ip.split(".").map(Number);
    const [a, b] = parts;
    if (parts.length !== 4 || parts.some((p) => !Number.isFinite(p) || p < 0 || p > 255)) return true;
    if (a === 127 || a === 10 || a === 0 || a >= 224) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 169 && b === 254) return true; // link-local incl. cloud metadata
    return false;
  }
  if (net.isIPv6(ip)) {
    const lower = ip.toLowerCase();
    if (lower === "::1" || lower === "::") return true;
    if (lower.startsWith("fe8") || lower.startsWith("fe9") || lower.startsWith("fea") || lower.startsWith("feb")) return true; // link-local
    if (lower.startsWith("fc") || lower.startsWith("fd")) return true; // unique-local
    if (lower.startsWith("::ffff:")) {
      const mapped = lower.slice(7);
      if (net.isIPv4(mapped)) return isDisallowedRemoteImageIp(mapped);
    }
    return false;
  }
  return true; // not a literal IP we recognize — treat as unsafe
}

export function isBlockedRemoteImageHostname(hostname: string): boolean {
  const lower = hostname.toLowerCase();
  return lower === "localhost" || lower.endsWith(".localhost") || lower.endsWith(".internal") || lower.endsWith(".local");
}

/**
 * A `dns.lookup`-compatible function that rejects any resolved address
 * `isDisallowedRemoteImageIp` flags, so the caller can pass it as the
 * `lookup` option of `http.get`/`https.get` — the same address that was
 * validated is the one actually connected to.
 */
export function createSsrfSafeLookup() {
  return (hostname: string, options: any, callback: any) => {
    const cb: any = typeof options === "function" ? options : callback;
    import("dns").then((dns) => {
      dns.lookup(hostname, {}, (err, address, family) => {
        if (err) return cb(err);
        if (isDisallowedRemoteImageIp(address)) return cb(new Error("BLOCKED_HOST"));
        cb(null, address, family);
      });
    }, cb);
  };
}

/**
 * Fetch one remote image URL, following up to REMOTE_IMAGE_MAX_REDIRECTS
 * redirect hops. Rejects on any non-2xx final status, a blocked host at any
 * hop, a response over REMOTE_IMAGE_MAX_BYTES, or exceeding
 * REMOTE_IMAGE_TOTAL_TIMEOUT_MS across the whole chain.
 */
export async function fetchRemoteImageBytesSafe(
  imageUrl: string,
  redirectsLeft = REMOTE_IMAGE_MAX_REDIRECTS,
  deadline = Date.now() + REMOTE_IMAGE_TOTAL_TIMEOUT_MS,
): Promise<Buffer> {
  const https = await import("https");
  const http = await import("http");
  let parsed: URL;
  try { parsed = new URL(imageUrl); } catch { throw new Error("INVALID_URL"); }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") throw new Error("BLOCKED_PROTOCOL");
  if (isBlockedRemoteImageHostname(parsed.hostname)) throw new Error("BLOCKED_HOST");
  if (Date.now() > deadline) throw new Error("TOTAL_TIMEOUT");
  const lookup = createSsrfSafeLookup();
  return new Promise((resolve, reject) => {
    const proto = parsed.protocol === "https:" ? https : http;
    const req = (proto as any).get(imageUrl, { timeout: REMOTE_IMAGE_PER_HOP_TIMEOUT_MS, lookup }, (res: any) => {
      const status = res.statusCode || 0;
      if (status >= 300 && status < 400 && res.headers.location && redirectsLeft > 0) {
        res.resume();
        const next = new URL(res.headers.location, imageUrl).toString();
        fetchRemoteImageBytesSafe(next, redirectsLeft - 1, deadline).then(resolve, reject);
        return;
      }
      if (status < 200 || status >= 300) {
        res.resume();
        reject(new Error(`HTTP_${status}`));
        return;
      }
      const chunks: Buffer[] = [];
      let total = 0;
      res.on("data", (c: Buffer) => {
        total += c.length;
        if (total > REMOTE_IMAGE_MAX_BYTES) {
          req.destroy(new Error("RESPONSE_TOO_LARGE"));
          return;
        }
        chunks.push(c);
      });
      res.on("end", () => resolve(Buffer.concat(chunks)));
      res.on("error", reject);
    });
    req.on("timeout", () => req.destroy(new Error("TIMEOUT")));
    req.on("error", reject);
  });
}
