#!/usr/bin/env tsx
/**
 * AST-based route extractor for Phase 0.5-B.
 *
 * Parses server/routes.ts (and any other file passed on argv) with the
 * TypeScript compiler API and finds every `app.<method>(path, ...)` /
 * `router.<method>(path, ...)` registration. Deliberately does not use
 * line-oriented regex to find routes — every match is a real CallExpression
 * node in the parsed AST, so it is robust to formatting, multi-line calls,
 * and comments that merely mention a path string.
 *
 * Output: a JSON array of raw route records to stdout. This is the single
 * source of truth both the classifier (classify-routes.ts) and the
 * completeness test (tests/route-manifest-completeness.test.ts) build on —
 * both re-run this same extractor rather than trusting a cached list, so
 * drift between the manifest and the real source is structurally caught.
 */
import fs from "node:fs";
import path from "node:path";
import ts from "typescript";

const HTTP_METHODS = new Set(["get", "post", "put", "patch", "delete", "all"]);
const ROUTER_RECEIVERS = new Set(["app", "router"]);

export interface RawArg {
  kind: string;
  text: string;
}

export interface RawRoute {
  method: string;
  routerReceiver: string;
  routePath: string;
  file: string;
  line: number;
  endLine: number;
  args: RawArg[];
  handlerBodyText: string;
  leadingComment: string;
}

function literalStringValue(node: ts.Node): string | null {
  if (ts.isStringLiteral(node)) return node.text;
  if (ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
  return null;
}

function literalStringArrayValues(node: ts.Node): string[] | null {
  if (!ts.isArrayLiteralExpression(node)) return null;
  const values: string[] = [];
  for (const el of node.elements) {
    const v = literalStringValue(el);
    if (v === null) return null;
    values.push(v);
  }
  return values;
}

function describeArg(node: ts.Node, sf: ts.SourceFile): RawArg {
  if (ts.isIdentifier(node)) {
    return { kind: "identifier", text: node.text };
  }
  if (ts.isCallExpression(node)) {
    const calleeText = node.expression.getText(sf);
    const argTexts = node.arguments.map((a) => a.getText(sf)).join(", ");
    return { kind: "call", text: `${calleeText}(${argTexts})` };
  }
  if (ts.isArrowFunction(node) || ts.isFunctionExpression(node)) {
    return { kind: "handler", text: "<inline handler>" };
  }
  if (ts.isPropertyAccessExpression(node)) {
    return { kind: "member", text: node.getText(sf) };
  }
  return { kind: "other", text: node.getText(sf).slice(0, 120) };
}

function leadingCommentFor(node: ts.Node, sf: ts.SourceFile): string {
  const fullText = sf.getFullText();
  const ranges = ts.getLeadingCommentRanges(fullText, node.getFullStart()) ?? [];
  return ranges
    .map((r) => fullText.slice(r.pos, r.end))
    .join("\n")
    .trim();
}

export function extractFromFile(filePath: string): RawRoute[] {
  const absPath = path.resolve(filePath);
  const sourceText = fs.readFileSync(absPath, "utf8");
  const sf = ts.createSourceFile(absPath, sourceText, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const routes: RawRoute[] = [];

  function visit(node: ts.Node) {
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      ts.isIdentifier(node.expression.expression) &&
      ROUTER_RECEIVERS.has(node.expression.expression.text) &&
      HTTP_METHODS.has(node.expression.name.text)
    ) {
      const receiver = node.expression.expression.text;
      const method = node.expression.name.text.toUpperCase();
      const [pathArg, ...rest] = node.arguments;
      const routePath = pathArg ? literalStringValue(pathArg) : null;
      const routePathArray = pathArg ? literalStringArrayValues(pathArg) : null;

      // Only count registrations whose path is a plain string/template literal
      // (or an array of them — Express allows registering one handler chain
      // under multiple paths) with no interpolation — every real route in
      // this codebase is declared this way. Anything else (a dynamic path
      // expression) is surfaced as a distinct "dynamic-path" record so it is
      // never silently dropped.
      const literalPaths = routePath !== null ? [routePath] : routePathArray;

      if (literalPaths !== null) {
        const start = node.getStart(sf);
        const { line } = sf.getLineAndCharacterOfPosition(start);
        const { line: endLine } = sf.getLineAndCharacterOfPosition(node.getEnd());
        const args = rest.map((a) => describeArg(a, sf));
        const lastArg = rest[rest.length - 1];
        const handlerBodyText =
          lastArg && (ts.isArrowFunction(lastArg) || ts.isFunctionExpression(lastArg))
            ? lastArg.getText(sf)
            : "";
        for (const p of literalPaths) {
          routes.push({
            method,
            routerReceiver: receiver,
            routePath: p,
            file: path.relative(process.cwd(), absPath),
            line: line + 1,
            endLine: endLine + 1,
            args,
            handlerBodyText,
            leadingComment: leadingCommentFor(node, sf),
          });
        }
      } else if (pathArg) {
        const start = node.getStart(sf);
        const { line } = sf.getLineAndCharacterOfPosition(start);
        routes.push({
          method,
          routerReceiver: receiver,
          routePath: `<dynamic:${pathArg.getText(sf).slice(0, 80)}>`,
          file: path.relative(process.cwd(), absPath),
          line: line + 1,
          endLine: line + 1,
          args: rest.map((a) => describeArg(a, sf)),
          handlerBodyText: "",
          leadingComment: leadingCommentFor(node, sf),
        });
      }
    }
    ts.forEachChild(node, visit);
  }

  visit(sf);
  return routes;
}

function main() {
  const files = process.argv.slice(2);
  if (files.length === 0) {
    console.error("Usage: tsx scripts/route-inventory/extract-routes.ts <file...>");
    process.exit(2);
  }
  const all = files.flatMap((f) => extractFromFile(f));
  console.log(JSON.stringify(all, null, 2));
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
