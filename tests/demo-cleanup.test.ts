/**
 * Runtime + static regression tests for demo-tenant cleanup with
 * integrity-protected companies.
 *
 * Run: npx tsx tests/demo-cleanup.test.ts
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import {
  runDemoCleanup,
  isIntegrityProtected,
  INTEGRITY_REPAIR_MARKER,
  type DemoCleanupCandidate,
  type DemoCleanupDeps,
  type DemoCleanupThrottleState,
} from "../server/workers/demo-cleanup.js";

let pass = 0;
let fail = 0;
function ok(name: string, result: boolean, detail?: string) {
  if (result) {
    pass++;
    console.log(`  ✓ ${name}`);
  } else {
    fail++;
    console.error(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

function candidate(over: Partial<DemoCleanupCandidate> & { id: string }): DemoCleanupCandidate {
  return { name: "Demo Company", gate_override_reason: null, ...over };
}

interface Harness {
  deps: DemoCleanupDeps;
  deletedIds: string[];
  logs: string[];
  warns: string[];
  throttle: DemoCleanupThrottleState;
}

function harness(opts: {
  candidates: DemoCleanupCandidate[];
  blocked?: Set<string>;
  throttle?: DemoCleanupThrottleState;
}): Harness {
  const deletedIds: string[] = [];
  const logs: string[] = [];
  const warns: string[] = [];
  const throttle: DemoCleanupThrottleState = opts.throttle ?? { lastProtectedSignature: null };
  const deps: DemoCleanupDeps = {
    selectCandidates: async () => opts.candidates,
    deleteCompany: async (id: string) => {
      if (opts.blocked?.has(id)) {
        throw new Error(
          `update or delete on table "companies" violates foreign key constraint ` +
            `"document_folders_company_id_fkey" on table "document_folders"`,
        );
      }
      deletedIds.push(id);
      return 1;
    },
    log: (m) => logs.push(m),
    warn: (m) => warns.push(m),
    throttle,
  };
  return { deps, deletedIds, logs, warns, throttle };
}

const PROTECTED_REASON = "integrity-repair 2026-01-01: additive parent restore (orphan 00000000)";

console.log("=== demo-cleanup: integrity-protected companies ===\n");

// -- predicate --------------------------------------------------------------
ok(
  "isIntegrityProtected: true when reason begins with the marker",
  isIntegrityProtected(candidate({ id: "a", gate_override_reason: PROTECTED_REASON })),
);
ok(
  "isIntegrityProtected: false for null / unrelated reasons",
  !isIntegrityProtected(candidate({ id: "b", gate_override_reason: null })) &&
    !isIntegrityProtected(candidate({ id: "c", gate_override_reason: "manual gate override for support" })),
);
ok("marker is the documented 'integrity-repair' prefix", INTEGRITY_REPAIR_MARKER === "integrity-repair");

// -- protected company is skipped; its records are untouched ---------------
{
  const protectedA = candidate({ id: "prot-A", gate_override_reason: PROTECTED_REASON });
  const ordinaryB = candidate({ id: "ord-B", name: "Acme Demo" });
  const h = harness({ candidates: [protectedA, ordinaryB] });
  const res = await runDemoCleanup(h.deps);

  ok("protected company is never passed to deleteCompany", !h.deletedIds.includes("prot-A"));
  ok(
    "protected company's dependent records are untouched (no delete/mutate call references it)",
    h.deletedIds.every((id) => id !== "prot-A") && h.warns.every((w) => !w.includes("prot-A")),
  );
  ok("result reports one protected company skipped", res.protectedSkipped === 1);

  // -- a normal eligible demo company is still cleaned up -------------------
  ok("ordinary eligible demo company is still deleted", h.deletedIds.includes("ord-B"));
  ok("exactly the ordinary company was removed", res.removed === 1 && h.deletedIds.length === 1);
  ok(
    'ordinary removal still logs "Removed N expired demo tenant(s)."',
    h.logs.some((l) => l === "Removed 1 expired demo tenant(s)."),
  );
}

// -- one blocked non-protected company does not stop another --------------
{
  const blockedX = candidate({ id: "ord-X", name: "Blocked Demo" });
  const okY = candidate({ id: "ord-Y", name: "Fine Demo" });
  const h = harness({ candidates: [blockedX, okY], blocked: new Set(["ord-X"]) });
  const res = await runDemoCleanup(h.deps);

  ok("blocked company does not prevent the next company from being processed", h.deletedIds.includes("ord-Y"));
  ok("blocked company is counted as a failure, not a removal", res.failed === 1 && res.removed === 1);
  ok(
    "unexpected FK failure on a non-protected company is surfaced as a warning",
    h.warns.some((w) => w.includes("ord-X") && w.toLowerCase().includes("foreign key")),
  );
}

// -- protected-company logging is sanitized and throttled ----------------
{
  const p1 = candidate({ id: "prot-1", name: "Demo Company", gate_override_reason: PROTECTED_REASON });
  const p2 = candidate({ id: "prot-2", name: "Secret Client LLC", gate_override_reason: PROTECTED_REASON });
  const throttle: DemoCleanupThrottleState = { lastProtectedSignature: null };

  const run1 = harness({ candidates: [p1, p2], throttle });
  await runDemoCleanup(run1.deps);
  const summary1 = run1.logs.filter((l) => l.includes("integrity-protected"));

  ok("protected summary is emitted once on first run", summary1.length === 1);
  ok(
    "protected summary is sanitized: a count only, no ids / names / reasons",
    summary1.length === 1 &&
      /^\d+ integrity-protected demo company/.test(summary1[0]) &&
      !summary1[0].includes("prot-1") &&
      !summary1[0].includes("prot-2") &&
      !summary1[0].includes("Secret Client LLC") &&
      !summary1[0].includes("2026-01-01") &&
      !summary1[0].includes(PROTECTED_REASON),
  );

  const run2 = harness({ candidates: [p1, p2], throttle });
  await runDemoCleanup(run2.deps);
  ok(
    "protected summary is NOT repeated when the protected set is unchanged",
    run2.logs.filter((l) => l.includes("integrity-protected")).length === 0,
  );

  const run3 = harness({ candidates: [p1], throttle });
  await runDemoCleanup(run3.deps);
  ok(
    "protected summary is re-emitted when the protected set changes",
    run3.logs.filter((l) => l.includes("integrity-protected")).length === 1,
  );

  const run4 = harness({ candidates: [], throttle });
  await runDemoCleanup(run4.deps);
  const run5 = harness({ candidates: [p1], throttle });
  await runDemoCleanup(run5.deps);
  ok(
    "protected summary re-appears if the protected set empties and later returns",
    run4.logs.filter((l) => l.includes("integrity-protected")).length === 0 &&
      run5.logs.filter((l) => l.includes("integrity-protected")).length === 1,
  );
}

// -- existing behaviour outside this case does not regress ---------------
{
  const empty = harness({ candidates: [] });
  const resEmpty = await runDemoCleanup(empty.deps);
  ok(
    "no candidates: nothing logged, nothing warned, zero result",
    empty.logs.length === 0 &&
      empty.warns.length === 0 &&
      resEmpty.removed === 0 &&
      resEmpty.protectedSkipped === 0 &&
      resEmpty.failed === 0,
  );

  const many = harness({
    candidates: [candidate({ id: "d1", name: "D1" }), candidate({ id: "d2", name: "D2" })],
  });
  const resMany = await runDemoCleanup(many.deps);
  ok(
    "multiple ordinary candidates are each removed independently",
    resMany.removed === 2 &&
      many.deletedIds.length === 2 &&
      many.warns.length === 0 &&
      many.logs.some((l) => l === "Removed 2 expired demo tenant(s)."),
  );
}

// -- static: no foreign-key / cascade behaviour change ------------------
{
  const core = fs.readFileSync("server/workers/demo-cleanup.ts", "utf8");
  const orch = fs.readFileSync("server/workers/orchestrator.ts", "utf8");
  const both = core + "\n" + orch;

  ok(
    "no cascade / constraint mutation / trigger bypass introduced",
    !/ON\s+DELETE\s+CASCADE|DROP\s+CONSTRAINT|ADD\s+CONSTRAINT|ALTER\s+TABLE|DISABLE\s+TRIGGER|session_replication_role/i.test(
      both,
    ),
  );
  ok(
    "cleanup still only ever DELETEs from the companies table",
    (both.match(/DELETE\s+FROM\s+(\w+)/gi) ?? []).every((m) => /companies/i.test(m)),
  );
  ok(
    "per-company DELETE keeps the full demo-expiry predicate",
    /DELETE FROM companies[\s\S]*?is_demo\s+=\s+TRUE[\s\S]*?trial_end\s+IS NOT NULL[\s\S]*?INTERVAL '2 hours'[\s\S]*?name NOT IN \('Demo Corp', '__demo_provision__'\)/.test(
      orch,
    ),
  );
  ok(
    "per-company DELETE also refuses integrity-repair rows in SQL (defence in depth)",
    /gate_override_reason NOT LIKE 'integrity-repair%'/.test(orch),
  );
  ok(
    "candidates are processed one id at a time (no multi-row companies DELETE without an id bound)",
    /deleteCompany:\s*async \(id: string\)/.test(orch) && /WHERE\s+id\s+=\s+\$\{id\}/.test(orch),
  );
}

console.log(`\n=== ${pass} passed, ${fail} failed ===`);
process.exit(fail === 0 ? 0 : 1);
