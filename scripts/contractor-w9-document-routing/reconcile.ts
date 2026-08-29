#!/usr/bin/env tsx
/**
 * Contractor W-9 / compliance-document reconciliation.
 *
 * Problem: some contractors' W-9s and contractor agreements were uploaded
 * through the worker profile's Documents tab and live only in
 * `worker_documents`. The contractor profile and the W-9 status derive from
 * `contractor_documents`, so those documents show as missing.
 *
 * This script LINKS (never copies) each such `worker_documents` row into
 * `contractor_documents` by inserting a metadata row that points at the
 * SAME `file_url`. The binary is never duplicated. It is:
 *   - dry-run by default; writes only with --apply
 *   - idempotent: a re-run inserts nothing (dedup key = worker_id + file_url)
 *   - tenant-scoped: company scope is mandatory. --apply always requires
 *     --company <id> (writes are single-company only). A dry-run requires
 *     either --company <id> or an explicit --all-companies opt-in.
 *   - silent about content: it prints aggregate counts only — never names,
 *     SSNs/TINs, document contents, file URLs, storage keys, or signed URLs
 *
 * It does NOT delete, move, or modify any existing `worker_documents` row,
 * and it does NOT touch employee relationships.
 *
 * Usage:
 *   # dry-run, one company
 *   tsx scripts/contractor-w9-document-routing/reconcile.ts \
 *     --database-url postgres://... --company <id>
 *   # dry-run, aggregate sweep across every company (read-only)
 *   tsx scripts/contractor-w9-document-routing/reconcile.ts \
 *     --database-url postgres://... --all-companies
 *   # apply (single company only)
 *   tsx scripts/contractor-w9-document-routing/reconcile.ts \
 *     --database-url postgres://... --company <id> --apply [--allow-protected]
 *
 * Running --apply against a staging/production-shaped database name requires
 * --allow-protected AND, per the repair plan, separate written approval.
 */
import { Pool } from "pg";
import { classifyContractorComplianceDoc } from "../../shared/schema";

interface Args { databaseUrl: string; company: string | null; allCompanies: boolean; apply: boolean; allowProtected: boolean; }

function parseArgs(argv: string[]): Args {
  const get = (flag: string): string | null => {
    const i = argv.indexOf(flag);
    return i >= 0 && i + 1 < argv.length ? argv[i + 1] : null;
  };
  const databaseUrl = get("--database-url") || process.env.RECONCILE_DATABASE_URL || process.env.DATABASE_URL || "";
  if (!databaseUrl) {
    console.error("A database URL is required (--database-url, RECONCILE_DATABASE_URL, or DATABASE_URL).");
    process.exit(2);
  }
  return {
    databaseUrl,
    company: get("--company"),
    allCompanies: argv.includes("--all-companies"),
    apply: argv.includes("--apply"),
    allowProtected: argv.includes("--allow-protected"),
  };
}

const PROTECTED_DB_PATTERNS = [/apppaylinkmain/i, /apppaylinkstaging/i, /prod/i, /staging/i];
const RECONCILE_MARKER = "system:w9-doc-reconcile";

/**
 * Company-scope gate. Runs before any DB connection so a mis-scoped
 * invocation never opens a pool. Writes must always target a single
 * company; a dry-run may sweep every company only with an explicit
 * --all-companies opt-in.
 */
function assertCompanyScope(args: Args): void {
  if (args.apply && !args.company) {
    console.error(`\nRefusing to --apply without --company <id>. Writes are single-company only.`);
    process.exit(4);
  }
  if (args.allCompanies && args.company) {
    console.error(`\nPass either --company <id> or --all-companies, not both.`);
    process.exit(4);
  }
  if (!args.company && !args.allCompanies) {
    console.error(`\nCompany scope is required. Pass --company <id>, or --all-companies for a read-only aggregate dry-run.`);
    process.exit(4);
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  assertCompanyScope(args);
  const pool = new Pool({ connectionString: args.databaseUrl, max: 4 });

  try {
    const { rows: dbRows } = await pool.query<{ name: string }>("SELECT current_database() AS name");
    const dbName = dbRows[0]?.name ?? "(unknown)";
    const isProtected = PROTECTED_DB_PATTERNS.some((p) => p.test(dbName) || p.test(args.databaseUrl));

    console.log(`── contractor-w9 reconciliation ──`);
    console.log(`database        : ${dbName}`);
    console.log(`mode            : ${args.apply ? "APPLY (writes enabled)" : "dry-run (no writes)"}`);
    console.log(`company scope   : ${args.company ? args.company : "ALL companies (dry-run sweep)"}`);

    if (args.apply && isProtected && !args.allowProtected) {
      console.error(`\nRefusing to --apply against a protected database ("${dbName}") without --allow-protected.`);
      console.error(`Per the repair plan this also requires separate written approval. Aborting.`);
      process.exit(3);
    }

    // Candidate worker_documents rows for contractor-type workers.
    const { rows: candidates } = await pool.query<{
      wd_id: string; worker_id: string; company_id: string;
      document_type: string | null; name: string | null; file_url: string;
    }>(
      `SELECT wd.id AS wd_id, wd.worker_id, w.company_id, wd.document_type, wd.name, wd.file_url
         FROM worker_documents wd
         JOIN workers w ON w.id = wd.worker_id AND w.worker_type = 'contractor'
        WHERE ($1::varchar IS NULL OR w.company_id = $1)`,
      [args.company],
    );

    const workersSeen = new Set<string>();
    const byType: Record<string, number> = {};
    let classified = 0;
    let alreadyLinked = 0;
    let linked = 0;

    for (const c of candidates) {
      workersSeen.add(c.worker_id);
      const canonicalType = classifyContractorComplianceDoc(c.document_type, c.name);
      if (!canonicalType) continue;
      classified++;

      const { rowCount: exists } = await pool.query(
        `SELECT 1 FROM contractor_documents WHERE worker_id = $1::varchar AND file_url = $2::text LIMIT 1`,
        [c.worker_id, c.file_url],
      );
      if (exists) { alreadyLinked++; continue; }

      byType[canonicalType] = (byType[canonicalType] ?? 0) + 1;

      if (args.apply) {
        const client = await pool.connect();
        try {
          await client.query("BEGIN");
          // Re-check inside the transaction (idempotent even under retry/concurrency).
          const dup = await client.query(
            `SELECT 1 FROM contractor_documents WHERE worker_id = $1::varchar AND file_url = $2::text LIMIT 1`,
            [c.worker_id, c.file_url],
          );
          const ins = (dup.rowCount ?? 0) > 0
            ? { rowCount: 0, rows: [] as { id: string }[] }
            : await client.query<{ id: string }>(
                `INSERT INTO contractor_documents
                   (company_id, worker_id, document_type, file_name, file_url, notes, uploaded_by)
                 VALUES ($1::varchar, $2::varchar, $3::text, COALESCE($4::text, 'Contractor document'),
                         $5::text, 'Linked from worker profile by reconciliation', $6::varchar)
                 RETURNING id`,
                [c.company_id, c.worker_id, canonicalType, c.name, c.file_url, RECONCILE_MARKER],
              );
          if ((ins.rowCount ?? 0) > 0) {
            await client.query(
              `INSERT INTO compliance_audit_events
                 (company_id, worker_id, rule_type, entity_type, entity_id, severity, message, detail)
               VALUES ($1::varchar, $2::varchar, 'contractor_document', 'worker', $3::text, 'info',
                       'contractor_document.associated', $4::jsonb)`,
              [c.company_id, c.worker_id, c.worker_id, JSON.stringify({ event: "associated", documentType: canonicalType, source: "worker_document", docId: ins.rows[0].id, actorUserId: RECONCILE_MARKER })],
            );
            linked++;
          } else {
            alreadyLinked++;
          }
          await client.query("COMMIT");
        } catch (e) {
          await client.query("ROLLBACK");
          throw e;
        } finally {
          client.release();
        }
      } else {
        linked++; // would-link
      }
    }

    console.log(`\n── results (aggregate only) ──`);
    console.log(`contractor workers scanned         : ${workersSeen.size}`);
    console.log(`worker_documents rows examined      : ${candidates.length}`);
    console.log(`classified as contractor compliance : ${classified}`);
    console.log(`already linked (idempotent skips)   : ${alreadyLinked}`);
    console.log(`${args.apply ? "linked this run" : "would link"}                    : ${linked}`);
    for (const [t, n] of Object.entries(byType).sort()) {
      console.log(`  - ${t}: ${n}`);
    }
    if (!args.apply && linked > 0) {
      console.log(`\nRe-run with --apply to write the ${linked} link row(s).`);
    }
  } finally {
    await pool.end();
  }
}

main().catch((e) => {
  console.error("reconciliation failed:", (e as Error).message);
  process.exit(1);
});
