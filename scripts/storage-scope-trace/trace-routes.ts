#!/usr/bin/env tsx
/**
 * Phase 0.5r — storage-layer tenant-scoping trace.
 *
 * Input: the Phase 0.5-B route-security manifest
 * (docs/saas-readiness/route-security-manifest.json). Target set: every route
 * classified `authenticated global/self-service` at `low` confidence (no
 * scoping signal was found in the route handler itself), unioned with every
 * route flagged `clientSuppliedCompanyIdWithoutMembershipCheck`. For each
 * target route this script does ONE additional static hop that 0.5-B did not:
 * it re-parses the route's own handler body for calls into the storage layer
 * (`storage.<method>(...)`) and/or inline `db.<verb>(...)` queries, resolves
 * each `storage.<method>` against a fresh AST-derived index of
 * `DatabaseStorage`'s methods (extract-storage-methods.ts), and checks
 * whether that storage call (or the inline query) filters by a
 * companyId/tenantId column tied to one of its own parameters.
 *
 * This is still a single static hop — it does not follow a storage method
 * that itself calls another storage method, and it does not resolve
 * scoping enforced via a join through a *different* table. Every entry
 * records exactly what evidence was found and where, so "verified-safe"
 * always cites a concrete WHERE-clause line, never an inference. Where the
 * evidence is genuinely inconclusive, the disposition is "unresolved" —
 * never a claim of a confirmed vulnerability.
 *
 * Usage: tsx scripts/storage-scope-trace/trace-routes.ts [--check|--write]
 */
import fs from "node:fs";
import path from "node:path";
import { extractFromFile, type RawRoute } from "../route-inventory/extract-routes";
import { extractStorageMethods, type StorageMethod } from "./extract-storage-methods";

const ROUTE_FILES = ["server/routes.ts", "server/feedback-routes.ts"];
const ROUTE_MANIFEST_PATH = "docs/saas-readiness/route-security-manifest.json";
const STORAGE_FILE = "server/storage.ts";
const OUT_MANIFEST_PATH = "docs/saas-readiness/storage-scope-trace-manifest.json";
const MANIFEST_VERSION = 1;

type Disposition = "verified-safe" | "needs-runtime-hardening" | "needs-negative-test" | "unresolved";

interface RouteManifestEntry {
  id: string;
  method: string;
  path: string;
  source: string;
  category: string;
  confidence: "high" | "medium" | "low";
  companyContext: { sources: string[]; hasMembershipCheck: boolean; hasEnforceScopeMiddleware: boolean };
  findings: { clientSuppliedCompanyIdWithoutMembershipCheck: boolean };
}

interface StorageCallResult {
  name: string;
  resolved: boolean;
  hasCompanyIdParam: boolean;
  filtersByCompanyIdInBody: boolean;
  hasIdOnlyPrimaryLookup: boolean;
  evidence: string;
  source: string;
}

interface TraceEntry {
  id: string;
  method: string;
  path: string;
  source: string;
  targetReasons: string[];
  storageCalls: StorageCallResult[];
  inlineDbQuery: { present: boolean; filtersByCompanyId: boolean; idOnly: boolean; evidence: string };
  disposition: Disposition;
  reason: string;
  confidence: "high" | "medium" | "low";
}

const COMPANY_FILTER_RE = /eq\(\s*[\w.]+\.(companyId|tenantId)\s*,\s*(companyId|tenantId)\s*\)/;
const ID_ONLY_WHERE_RE = /\.where\(\s*eq\(\s*[\w.]+\.id\s*,\s*\w+\s*\)\s*\)/;
const STORAGE_CALL_RE = /\bstorage\.(\w+)\(/g;
const INLINE_DB_QUERY_RE = /\bdb\.(select|insert|update|delete)\(/;

function buildStorageIndex(): Map<string, StorageMethod> {
  const methods = extractStorageMethods(STORAGE_FILE);
  const index = new Map<string, StorageMethod>();
  for (const m of methods) if (!index.has(m.name)) index.set(m.name, m);
  return index;
}

function findStorageCalls(handlerBodyText: string): string[] {
  const names = new Set<string>();
  let match: RegExpExecArray | null;
  STORAGE_CALL_RE.lastIndex = 0;
  while ((match = STORAGE_CALL_RE.exec(handlerBodyText)) !== null) names.add(match[1]);
  return [...names];
}

function traceInlineDbQuery(handlerBodyText: string): TraceEntry["inlineDbQuery"] {
  if (!INLINE_DB_QUERY_RE.test(handlerBodyText)) return { present: false, filtersByCompanyId: false, idOnly: false, evidence: "" };
  const lines = handlerBodyText.split("\n").map((l) => l.trim());
  const filterLine = lines.find((l) => COMPANY_FILTER_RE.test(l));
  const idOnlyLine = lines.find((l) => ID_ONLY_WHERE_RE.test(l));
  return {
    present: true,
    filtersByCompanyId: !!filterLine,
    idOnly: !filterLine && !!idOnlyLine,
    evidence: (filterLine ?? idOnlyLine ?? "").slice(0, 200),
  };
}

function classify(
  routeEntry: RouteManifestEntry,
  storageCalls: StorageCallResult[],
  inlineDbQuery: TraceEntry["inlineDbQuery"],
): { disposition: Disposition; reason: string; confidence: "high" | "medium" | "low" } {
  const resolvedCalls = storageCalls.filter((c) => c.resolved);
  const unresolvedCallNames = storageCalls.filter((c) => !c.resolved).map((c) => c.name);

  const hasAnyEvidence = resolvedCalls.length > 0 || inlineDbQuery.present;

  if (!hasAnyEvidence) {
    return {
      disposition: "unresolved",
      reason:
        storageCalls.length > 0
          ? `storage method(s) called but not found in the DatabaseStorage index: ${unresolvedCallNames.join(", ")}`
          : "no storage.* call or inline db query detected in the route handler body (handler may be a named function reference, or delegate to a helper this trace does not follow)",
      confidence: "low",
    };
  }

  const anyUnscoped =
    resolvedCalls.some((c) => c.hasIdOnlyPrimaryLookup && !c.filtersByCompanyIdInBody) || (inlineDbQuery.present && inlineDbQuery.idOnly);
  const anyScoped = resolvedCalls.some((c) => c.hasCompanyIdParam && c.filtersByCompanyIdInBody) || (inlineDbQuery.present && inlineDbQuery.filtersByCompanyId);

  if (anyUnscoped && !anyScoped) {
    if (routeEntry.companyContext.hasMembershipCheck || routeEntry.companyContext.hasEnforceScopeMiddleware) {
      return {
        disposition: "needs-negative-test",
        reason:
          "storage/query layer performs an id-only lookup with no companyId filter, but the route itself carries a detected membership check or enforceCompanyScope middleware — likely scoped one level up; needs a cross-tenant regression test to confirm before this can be called verified-safe.",
        confidence: "medium",
      };
    }
    return {
      disposition: "needs-runtime-hardening",
      reason:
        "storage/query layer performs an id-only lookup with no companyId/tenantId filter (evidence: " +
        (resolvedCalls.find((c) => c.hasIdOnlyPrimaryLookup)?.evidence || inlineDbQuery.evidence) +
        "), and no membership check or enforceCompanyScope middleware was detected on the route. No tenant-scoping mechanism was found at either layer.",
      confidence: "high",
    };
  }

  if (anyScoped) {
    if (routeEntry.findings.clientSuppliedCompanyIdWithoutMembershipCheck) {
      return {
        disposition: "needs-runtime-hardening",
        reason:
          "the resolved storage/query call does filter by companyId, but the route's own companyId source is client-supplied (query/body/params) with no membership check (per the Phase 0.5-B manifest) — the scoping mechanism exists but may be fed an unvalidated tenant id.",
        confidence: "medium",
      };
    }
    if (routeEntry.companyContext.sources.includes("session")) {
      return {
        disposition: "needs-negative-test",
        reason: "resolved storage/query call filters by companyId and the route's companyId source is session-derived — appears correctly scoped; no automated cross-tenant regression test currently covers this route.",
        confidence: "high",
      };
    }
    return {
      disposition: "needs-negative-test",
      reason: "resolved storage/query call filters by companyId, but this trace could not confirm the argument's origin at the call site (single-hop static analysis only) — treat as probably scoped, confirm with a negative test.",
      confidence: "low",
    };
  }

  return {
    disposition: "unresolved",
    reason: "storage/query call(s) resolved but neither a companyId filter nor an id-only lookup pattern matched — the method may use a scoping shape (join, IN-list, relational query API) this single-hop static trace does not recognize.",
    confidence: "low",
  };
}

function buildManifest() {
  const routeManifest = JSON.parse(fs.readFileSync(ROUTE_MANIFEST_PATH, "utf8")) as { entries: RouteManifestEntry[] };
  const storageIndex = buildStorageIndex();

  const rawRoutes: RawRoute[] = ROUTE_FILES.flatMap((f) => extractFromFile(f));
  const rawByKey = new Map<string, RawRoute>();
  for (const r of rawRoutes) rawByKey.set(`${r.method} ${r.routePath}@${r.file}:${r.line}`, r);

  const targets = routeManifest.entries.filter((e) => {
    const reasons: string[] = [];
    if (e.category === "authenticated global/self-service" && e.confidence === "low") reasons.push("low-confidence-global-self-service");
    if (e.findings.clientSuppliedCompanyIdWithoutMembershipCheck) reasons.push("client-supplied-companyId");
    return reasons.length > 0;
  });

  const entries: TraceEntry[] = targets.map((routeEntry) => {
    const targetReasons: string[] = [];
    if (routeEntry.category === "authenticated global/self-service" && routeEntry.confidence === "low") targetReasons.push("low-confidence-global-self-service");
    if (routeEntry.findings.clientSuppliedCompanyIdWithoutMembershipCheck) targetReasons.push("client-supplied-companyId");

    const key = `${routeEntry.method} ${routeEntry.path}@${routeEntry.source}`;
    const raw = rawByKey.get(key);
    const handlerBodyText = raw?.handlerBodyText ?? "";

    const callNames = findStorageCalls(handlerBodyText);
    const storageCalls: StorageCallResult[] = callNames.map((name) => {
      const m = storageIndex.get(name);
      if (!m) {
        return { name, resolved: false, hasCompanyIdParam: false, filtersByCompanyIdInBody: false, hasIdOnlyPrimaryLookup: false, evidence: "", source: "" };
      }
      return {
        name,
        resolved: true,
        hasCompanyIdParam: m.hasCompanyIdParam,
        filtersByCompanyIdInBody: m.filtersByCompanyIdInBody,
        hasIdOnlyPrimaryLookup: m.hasIdOnlyPrimaryLookup,
        evidence: m.evidence,
        source: `server/storage.ts:${m.line}`,
      };
    });

    const inlineDbQuery = traceInlineDbQuery(handlerBodyText);
    const { disposition, reason, confidence } = classify(routeEntry, storageCalls, inlineDbQuery);

    return {
      id: routeEntry.id,
      method: routeEntry.method,
      path: routeEntry.path,
      source: routeEntry.source,
      targetReasons,
      storageCalls,
      inlineDbQuery,
      disposition,
      reason,
      confidence,
    };
  });

  entries.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

  return {
    generatedAt: new Date().toISOString().slice(0, 10),
    version: MANIFEST_VERSION,
    sourceRouteManifestVersion: (JSON.parse(fs.readFileSync(ROUTE_MANIFEST_PATH, "utf8")) as { version: number }).version,
    targetCount: entries.length,
    entries,
  };
}

function main() {
  const mode = process.argv[2];
  const manifest = buildManifest();

  if (mode === "--check") {
    if (!fs.existsSync(OUT_MANIFEST_PATH)) {
      console.error(`FAIL: ${OUT_MANIFEST_PATH} does not exist. Run: tsx scripts/storage-scope-trace/trace-routes.ts --write`);
      process.exit(1);
    }
    const committed = JSON.parse(fs.readFileSync(OUT_MANIFEST_PATH, "utf8"));
    const committedIds = new Set<string>(committed.entries.map((e: TraceEntry) => e.id));
    const currentIds = new Set<string>(manifest.entries.map((e) => e.id));
    const missing = [...currentIds].filter((id) => !committedIds.has(id));
    const stale = [...committedIds].filter((id) => !currentIds.has(id));
    const dispositionDrift = manifest.entries.filter((e) => {
      const c = committed.entries.find((x: TraceEntry) => x.id === e.id);
      return c && c.disposition !== e.disposition;
    });

    if (missing.length > 0 || stale.length > 0 || dispositionDrift.length > 0) {
      console.error("FAIL: storage-scope-trace-manifest.json is out of date with server source.");
      if (missing.length) console.error(`  Target routes in source but missing from manifest (${missing.length}):`, missing.slice(0, 20));
      if (stale.length) console.error(`  Routes in manifest no longer in target set (${stale.length}):`, stale.slice(0, 20));
      if (dispositionDrift.length) console.error(`  Routes whose disposition changed (${dispositionDrift.length}):`, dispositionDrift.slice(0, 20).map((e) => e.id));
      console.error("  Run: tsx scripts/storage-scope-trace/trace-routes.ts --write");
      process.exit(1);
    }
    console.log(`OK: storage-scope-trace manifest is current — ${manifest.targetCount} target routes, all traced and disposed.`);
    process.exit(0);
  }

  if (mode === "--write") {
    fs.writeFileSync(OUT_MANIFEST_PATH, JSON.stringify(manifest, null, 2) + "\n");
    console.log(`Wrote ${OUT_MANIFEST_PATH} — ${manifest.targetCount} target routes traced.`);
    process.exit(0);
  }

  console.log(JSON.stringify(manifest, null, 2));
}

const isDirectRun = (() => {
  try {
    return import.meta.url === `file://${process.argv[1]}`;
  } catch {
    return false;
  }
})();

if (isDirectRun) main();
