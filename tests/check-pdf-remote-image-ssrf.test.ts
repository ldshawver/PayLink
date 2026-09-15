/**
 * v2.2.7 check-printing recovery — SSRF protection for the check-face remote
 * logo fetch (company/bank logo URLs configured per tenant). Pure unit test,
 * no DB/network/server. See server/remote-image-fetch.ts.
 */
import assert from "node:assert/strict";
import { isDisallowedRemoteImageIp, isBlockedRemoteImageHostname } from "../server/remote-image-fetch.ts";

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

console.log(`\n=== ${pass} passed, ${fail} failed ===`);
process.exit(fail === 0 ? 0 : 1);
