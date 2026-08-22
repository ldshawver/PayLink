#!/usr/bin/env tsx
/**
 * AST-based extractor for `DatabaseStorage` methods in server/storage.ts.
 *
 * For each method, records its parameter names and its full body text, then
 * applies a static (regex-over-body) signal for whether the method's query
 * filters by a tenant/company identifier tied to one of its own parameters.
 * This is deliberately a single-hop, source-only signal — it does not
 * resolve joins through other tables or follow calls into other storage
 * methods — see the "unresolved" disposition in trace-routes.ts for the
 * honest fallback when this signal can't be determined from the method body
 * alone.
 */
import fs from "node:fs";
import path from "node:path";
import ts from "typescript";

export interface StorageMethod {
  name: string;
  line: number;
  endLine: number;
  params: string[];
  bodyText: string;
  hasCompanyIdParam: boolean;
  filtersByCompanyIdInBody: boolean;
  hasIdOnlyPrimaryLookup: boolean;
  evidence: string;
}

const COMPANY_PARAM_RE = /^(companyId|tenantId)\??$/;

// Matches `eq(<table>.companyId, companyId)` / `eq(<table>.tenantId, tenantId)`
// style filters used throughout server/storage.ts (and the same inside an
// `and(...)` combinator), tying the filter column to a same-named parameter.
const COMPANY_FILTER_RE = /eq\(\s*[\w.]+\.(companyId|tenantId)\s*,\s*(companyId|tenantId)\s*\)/;

// A lookup keyed only by primary `id` with no other `.where()` condition in
// the same call — the shape that produces a cross-tenant read/write if nothing
// else scopes it (e.g. `db.delete(table).where(eq(table.id, id))`).
const ID_ONLY_WHERE_RE = /\.where\(\s*eq\(\s*[\w.]+\.id\s*,\s*\w+\s*\)\s*\)/;

export function extractStorageMethods(filePath: string): StorageMethod[] {
  const absPath = path.resolve(filePath);
  const sourceText = fs.readFileSync(absPath, "utf8");
  const sf = ts.createSourceFile(absPath, sourceText, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);

  const methods: StorageMethod[] = [];

  function visit(node: ts.Node) {
    if (ts.isClassDeclaration(node) && node.name?.text === "DatabaseStorage") {
      for (const member of node.members) {
        if (!ts.isMethodDeclaration(member) || !member.body) continue;
        const name = member.name.getText(sf);
        const params = member.parameters.map((p) => p.name.getText(sf));
        const bodyText = member.body.getText(sf);
        const start = member.getStart(sf);
        const { line } = sf.getLineAndCharacterOfPosition(start);
        const { line: endLine } = sf.getLineAndCharacterOfPosition(member.getEnd());

        const hasCompanyIdParam = params.some((p) => COMPANY_PARAM_RE.test(p));
        const filtersByCompanyIdInBody = COMPANY_FILTER_RE.test(bodyText);
        const hasIdOnlyPrimaryLookup = ID_ONLY_WHERE_RE.test(bodyText) && !filtersByCompanyIdInBody;

        const evidenceLine = bodyText
          .split("\n")
          .map((l) => l.trim())
          .find((l) => (filtersByCompanyIdInBody && COMPANY_FILTER_RE.test(l)) || (hasIdOnlyPrimaryLookup && ID_ONLY_WHERE_RE.test(l)));

        methods.push({
          name,
          line: line + 1,
          endLine: endLine + 1,
          params,
          bodyText,
          hasCompanyIdParam,
          filtersByCompanyIdInBody,
          hasIdOnlyPrimaryLookup,
          evidence: evidenceLine ? evidenceLine.slice(0, 200) : "",
        });
      }
    }
    ts.forEachChild(node, visit);
  }

  visit(sf);
  return methods;
}

function main() {
  const file = process.argv[2] ?? "server/storage.ts";
  const methods = extractStorageMethods(file);
  console.log(JSON.stringify(methods.map(({ bodyText, ...rest }) => rest), null, 2));
}

const isDirectRun = (() => {
  try {
    return import.meta.url === `file://${process.argv[1]}`;
  } catch {
    return false;
  }
})();

if (isDirectRun) {
  main();
}
