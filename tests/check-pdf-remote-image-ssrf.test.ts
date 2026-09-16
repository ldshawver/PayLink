/**
 * v2.2.7 check-printing recovery — SSRF protection for the check-face remote
 * logo fetch (company/bank logo URLs configured per tenant). See
 * server/remote-image-fetch.ts. No DB, no real server, no external network —
 * the live-fetch section below binds a plain node:http server to 127.0.0.1
 * only (always available, no egress required) purely to prove a request
 * naming a blocked address is never even attempted.
 */
import assert from "node:assert/strict";
import http from "node:http";
import { isDisallowedRemoteImageIp, isBlockedRemoteImageHostname, fetchRemoteImageBytesSafe } from "../server/remote-image-fetch.ts";

let pass = 0, fail = 0;
const ok = (name: string, cond: boolean) => { if (cond) { pass++; console.log(`  ✓ ${name}`); } else { fail++; console.error(`  ✗ ${name}`); } };

console.log("=== check-face remote logo fetch: SSRF IP/host classification ===\n");

// Loopback
ok("127.0.0.1 is blocked", isDisallowedRemoteImageIp("127.0.0.1"));
ok("::1 is blocked", isDisallowedRemoteImageIp("::1"));
// RFC1918 private
ok("10.0.0.1 is blocked", isDisallowedRemoteImageIp("10.0.0.1"));
ok("172.16.0.1 is blocked", isDisallowedRemoteImageIp("172.16.0.1"));
ok("172.31.255.255 is blocked", isDisallowedRemoteImageIp("172.31.255.255"));
ok("172.32.0.1 (just outside the private range) is allowed", !isDisallowedRemoteImageIp("172.32.0.1"));
ok("192.168.1.1 is blocked", isDisallowedRemoteImageIp("192.168.1.1"));
// Link-local / cloud metadata
ok("169.254.169.254 (cloud metadata) is blocked", isDisallowedRemoteImageIp("169.254.169.254"));
ok("169.254.0.1 is blocked", isDisallowedRemoteImageIp("169.254.0.1"));
// This-network / multicast / reserved
ok("0.0.0.0 is blocked", isDisallowedRemoteImageIp("0.0.0.0"));
ok("224.0.0.1 (multicast) is blocked", isDisallowedRemoteImageIp("224.0.0.1"));
ok("255.255.255.255 is blocked", isDisallowedRemoteImageIp("255.255.255.255"));
// IPv6 link-local / unique-local
ok("fe80::1 (IPv6 link-local) is blocked", isDisallowedRemoteImageIp("fe80::1"));
ok("fc00::1 (IPv6 unique-local) is blocked", isDisallowedRemoteImageIp("fc00::1"));
ok("fd12:3456::1 (IPv6 unique-local) is blocked", isDisallowedRemoteImageIp("fd12:3456::1"));
// IPv4-mapped IPv6
ok("::ffff:169.254.169.254 (mapped cloud metadata) is blocked", isDisallowedRemoteImageIp("::ffff:169.254.169.254"));
ok("::ffff:8.8.8.8 (mapped public) is allowed", !isDisallowedRemoteImageIp("::ffff:8.8.8.8"));
// Public addresses are allowed
ok("8.8.8.8 (public) is allowed", !isDisallowedRemoteImageIp("8.8.8.8"));
ok("1.1.1.1 (public) is allowed", !isDisallowedRemoteImageIp("1.1.1.1"));
ok("a real public IPv6 address is allowed", !isDisallowedRemoteImageIp("2606:4700:4700::1111"));
// Malformed input fails closed
ok("a non-IP string is treated as unsafe (fail closed)", isDisallowedRemoteImageIp("not-an-ip"));

console.log("\n=== check-face remote logo fetch: blocked hostname patterns ===\n");
ok("localhost is blocked", isBlockedRemoteImageHostname("localhost"));
ok("foo.localhost is blocked", isBlockedRemoteImageHostname("foo.localhost"));
ok("metadata.internal is blocked", isBlockedRemoteImageHostname("metadata.internal"));
ok("printer.local is blocked", isBlockedRemoteImageHostname("printer.local"));
ok("a real public hostname is allowed", !isBlockedRemoteImageHostname("cdn.example.com"));

console.log("\n=== check-face remote logo fetch: connection-level SSRF bypass regression ===\n");
console.log("(A prior version of fetchRemoteImageBytesSafe validated the resolved address only");
console.log(" via a `lookup` option passed to http.get()/https.get(). Node's own connection logic");
console.log(" recognizes a hostname that already looks like an IP — including forms net.isIP()");
console.log(" itself doesn't, such as bare-decimal or hex — and connects straight to it WITHOUT");
console.log(" ever invoking `lookup`, so any such spelling of a blocked address bypassed the");
console.log(" filter entirely. These assertions prove the fetch is now blocked before a socket is");
console.log(" even opened, for every encoding that reached the real server unfiltered before the fix.\n");

async function liveBypassRegressionChecks() {
  let requestsReceived = 0;
  const server = http.createServer((_req, res) => { requestsReceived++; res.writeHead(200); res.end("should-never-be-reached"); });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as any).port;

  const blockedHostForms = [
    `http://127.0.0.1:${port}/`,          // dotted-decimal loopback
    `http://2130706433:${port}/`,          // pure-decimal encoding of 127.0.0.1
    `http://0x7f000001:${port}/`,          // hex encoding of 127.0.0.1
    `http://[::1]:${port}/`,               // bracketed IPv6 loopback literal
  ];
  for (const url of blockedHostForms) {
    try {
      await fetchRemoteImageBytesSafe(url);
      ok(`${url} is blocked`, false);
    } catch (e: any) {
      ok(`${url} is blocked (${e.message})`, e.message === "BLOCKED_HOST");
    }
  }
  ok("the local test server never received any of the blocked-host requests", requestsReceived === 0);

  await new Promise<void>((resolve) => server.close(() => resolve()));
}

await liveBypassRegressionChecks();

console.log(`\n=== ${pass} passed, ${fail} failed ===`);
process.exit(fail === 0 ? 0 : 1);
