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
 *  - Resolution and validation happen in application code BEFORE the request
 *    is made, and the socket connects directly to that already-validated
 *    address (Host/SNI still carry the original hostname) — never to a
 *    `lookup` hook passed to http.get()/https.get(). An earlier version of
 *    this file passed a validating `lookup` function as a request option
 *    instead; that is NOT equivalent and was a live SSRF bypass: Node's own
 *    connection logic recognizes a hostname that already looks like an IP —
 *    including forms `net.isIP()` itself doesn't recognize, such as bare
 *    decimal (`http://2130706433/` = 127.0.0.1) or hex (`http://0x7f000001/`)
 *    — and connects straight to it without ever invoking `lookup`, so a
 *    logo URL (or a redirect Location) spelling a blocked address as
 *    anything other than plain dotted-decimal sailed through unfiltered.
 *    Resolving explicitly here, once, and connecting to that literal
 *    address closes that gap regardless of how the host was spelled, and
 *    the single resolve-then-connect-to-that-address sequence also prevents
 *    a DNS-rebinding TOCTOU (no second, unvalidated resolution ever happens).
 *  - Response size is capped; total wall-clock time across all redirect hops
 *    is bounded by an explicit deadline timer (not just a per-hop idle
 *    socket timeout, which a slow steady trickle would never trip).
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

/** Resolve `hostname` and reject if it lands on a disallowed address. Strips
 * the brackets URL puts around a literal IPv6 host (`[::1]` -> `::1`) before
 * resolving, since a bracketed literal isn't itself a valid dns.lookup input. */
async function resolveAndValidateHost(hostname: string): Promise<{ address: string; family: number }> {
  const dns = await import("dns");
  const bare = hostname.replace(/^\[/, "").replace(/\]$/, "");
  const { address, family } = await new Promise<{ address: string; family: number }>((resolve, reject) => {
    dns.lookup(bare, {}, (err, address, family) => (err ? reject(err) : resolve({ address, family })));
  });
  if (isDisallowedRemoteImageIp(address)) throw new Error("BLOCKED_HOST");
  return { address, family };
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

  // Resolve + validate BEFORE connecting, once, here in application code —
  // see the file-level comment for why a `lookup` request option is not safe.
  const { address } = await resolveAndValidateHost(parsed.hostname);

  return new Promise((resolve, reject) => {
    const proto = parsed.protocol === "https:" ? https : http;
    const reqOptions: any = {
      protocol: parsed.protocol,
      hostname: address, // connect directly to the pre-validated literal address
      port: parsed.port ? Number(parsed.port) : (parsed.protocol === "https:" ? 443 : 80),
      path: `${parsed.pathname}${parsed.search}`,
      headers: { Host: parsed.host }, // preserve virtual-hosting / original Host
      timeout: REMOTE_IMAGE_PER_HOP_TIMEOUT_MS,
    };
    if (parsed.protocol === "https:") reqOptions.servername = parsed.hostname; // correct SNI + cert-hostname check
    const req = (proto as any).get(reqOptions, (res: any) => {
      const status = res.statusCode || 0;
      if (status >= 300 && status < 400 && res.headers.location && redirectsLeft > 0) {
        clearTimeout(hardDeadlineTimer);
        res.resume();
        const next = new URL(res.headers.location, imageUrl).toString();
        fetchRemoteImageBytesSafe(next, redirectsLeft - 1, deadline).then(resolve, reject);
        return;
      }
      if (status < 200 || status >= 300) {
        clearTimeout(hardDeadlineTimer);
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
      res.on("end", () => { clearTimeout(hardDeadlineTimer); resolve(Buffer.concat(chunks)); });
      res.on("error", (e: any) => { clearTimeout(hardDeadlineTimer); reject(e); });
    });
    req.on("timeout", () => req.destroy(new Error("TIMEOUT")));
    req.on("error", (e: any) => { clearTimeout(hardDeadlineTimer); reject(e); });
    // Per-hop `timeout` above is a socket IDLE timeout (resets on every byte
    // received) — on its own a slow, steady trickle of small chunks could
    // hold a single (non-redirecting) request open indefinitely without ever
    // going idle long enough to trip it. This hard deadline aborts the
    // request at the wall-clock cutoff regardless of ongoing activity, so
    // REMOTE_IMAGE_TOTAL_TIMEOUT_MS bounds real elapsed time, not just idle time.
    const hardDeadlineTimer = setTimeout(() => req.destroy(new Error("TOTAL_TIMEOUT")), Math.max(0, deadline - Date.now()));
  });
}
