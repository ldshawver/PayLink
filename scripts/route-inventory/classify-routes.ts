#!/usr/bin/env tsx
/**
 * Phase 0.5-B route classifier.
 *
 * Consumes the raw AST route list from extract-routes.ts plus the raw
 * `app.use(path, ...)` mount list, resolves per-route "effective" auth by
 * modeling Express's actual dispatch order (middleware/routes run in
 * registration order; a route registered before a gate never passes through
 * it), and writes the versioned route-security manifest.
 *
 * This is intentionally a single deterministic, re-runnable pass — the same
 * script backs both `npm run route-inventory:generate` (writes the manifest)
 * and the completeness test (`tests/route-manifest-completeness.test.ts`,
 * run with --check, which regenerates in-memory and diffs against the
 * committed manifest instead of trusting it blindly).
 */
import fs from "node:fs";
import path from "node:path";
import ts from "typescript";
import { extractFromFile, type RawRoute } from "./extract-routes";

const ROUTE_FILES = ["server/routes.ts", "server/feedback-routes.ts"];
const MANIFEST_VERSION = 1;
const MANIFEST_PATH = "docs/saas-readiness/route-security-manifest.json";

// ── Mount extraction (app.use(path, ...middleware)) ──────────────────────────

interface RawMount {
  file: string;
  line: number;
  mountPath: string;
  argTexts: string[];
  identifierArgs: string[];
  inlineBodyText: string;
}

function extractMounts(filePath: string): RawMount[] {
  const absPath = path.resolve(filePath);
  const sourceText = fs.readFileSync(absPath, "utf8");
  const sf = ts.createSourceFile(absPath, sourceText, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const mounts: RawMount[] = [];

  function visit(node: ts.Node) {
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      ts.isIdentifier(node.expression.expression) &&
      node.expression.expression.text === "app" &&
      node.expression.name.text === "use"
    ) {
      const [first, ...rest] = node.arguments;
      if (first && (ts.isStringLiteral(first) || ts.isNoSubstitutionTemplateLiteral(first))) {
        const start = node.getStart(sf);
        const { line } = sf.getLineAndCharacterOfPosition(start);
        const identifierArgs = rest.filter(ts.isIdentifier).map((a) => a.text);
        const inlineBodyText = rest
          .filter((a) => ts.isArrowFunction(a) || ts.isFunctionExpression(a))
          .map((a) => a.getText(sf))
          .join("\n");
        mounts.push({
          file: path.relative(process.cwd(), absPath),
          line: line + 1,
          mountPath: first.text,
          argTexts: rest.map((a) => a.getText(sf)),
          identifierArgs,
          inlineBodyText,
        });
      }
    }
    ts.forEachChild(node, visit);
  }

  visit(sf);
  return mounts;
}

// ── Auth resolution ───────────────────────────────────────────────────────────

const AUTH_IDENTIFIERS = new Set(["requireAuth", "requireSuperAdmin"]);
const ROLE_CALL_NAMES = new Set(["requireRole", "requirePlatformRole", "requireSuperAdmin"]);
const PLATFORM_CALL_NAMES = new Set(["requirePlatformRole"]);

interface AuthSignal {
  authenticated: boolean;
  source: "own-middleware" | "inherited-mount" | "global-backstop" | "none-detected";
  roleArgs: string[];
  platformOnly: boolean;
  detail: string;
}

function pathIsUnderPrefix(routePath: string, prefix: string): boolean {
  if (prefix === "/api") return routePath.startsWith("/api/") || routePath === "/api";
  return routePath === prefix || routePath.startsWith(prefix + "/");
}

// The global backstop gate at server/routes.ts's single `app.use("/api", ...)`
// mount whose inline body calls requireAuth conditionally. Its allowlist is
// extracted from the mount's own source text (see extractGlobalAllowlist)
// rather than hand-copied, so a future edit to the allowlist is picked up
// automatically instead of silently going stale.
function extractGlobalAllowlist(mount: RawMount): { exact: string[]; prefix: string[] } {
  const exact: string[] = [];
  const prefixes: string[] = [];
  const exactRe = /req\.path\s*===\s*["'`]([^"'`]+)["'`]/g;
  const prefixRe = /req\.path\.startsWith\(\s*["'`]([^"'`]+)["'`]\s*\)/g;
  let m: RegExpExecArray | null;
  while ((m = exactRe.exec(mount.inlineBodyText))) exact.push(m[1]);
  while ((m = prefixRe.exec(mount.inlineBodyText))) prefixes.push(m[1]);
  return { exact, prefix: prefixes };
}

function resolveAuth(route: RawRoute, mounts: RawMount[]): AuthSignal {
  const ownRole = route.args.find((a) => a.kind === "call" && [...ROLE_CALL_NAMES].some((n) => a.text.startsWith(n + "(")));
  const ownAuthIdent = route.args.find((a) => a.kind === "identifier" && AUTH_IDENTIFIERS.has(a.text));
  const ownPlatform = route.args.find((a) => a.kind === "call" && [...PLATFORM_CALL_NAMES].some((n) => a.text.startsWith(n + "(")));

  const roleArgs: string[] = [];
  for (const a of route.args) {
    if (a.kind === "call" && a.text.startsWith("requireRole(")) {
      const inner = a.text.slice("requireRole(".length, -1);
      roleArgs.push(...inner.split(",").map((s) => s.trim().replace(/^["'`]|["'`]$/g, "")).filter(Boolean));
    }
  }

  if (ownAuthIdent || ownRole || ownPlatform) {
    return {
      authenticated: true,
      source: "own-middleware",
      roleArgs,
      platformOnly: !!ownPlatform,
      detail: [ownAuthIdent?.text, ownRole?.text, ownPlatform?.text].filter(Boolean).join(", "),
    };
  }

  // Inherited from a path-prefix app.use(...) mount registered before this route.
  const applicableMounts = mounts
    .filter((m) => m.line < route.line)
    .filter((m) => pathIsUnderPrefix(route.routePath, m.mountPath))
    .sort((a, b) => b.line - a.line); // closest (most specific/last) mount first

  for (const mount of applicableMounts) {
    if (mount.identifierArgs.includes("requireAuth")) {
      return {
        authenticated: true,
        source: "inherited-mount",
        roleArgs: [],
        platformOnly: false,
        detail: `app.use("${mount.mountPath}", ...) @ ${mount.file}:${mount.line} includes requireAuth`,
      };
    }
    // The global backstop: an inline app.use("/api", (req,res,next)=>{...}) whose
    // body itself calls requireAuth(...) conditionally, guarded by an allowlist.
    if (mount.mountPath === "/api" && /requireAuth\(/.test(mount.inlineBodyText)) {
      const { exact, prefix } = extractGlobalAllowlist(mount);
      const bare = route.routePath.replace(/^\/api/, "");
      const isAllowlisted =
        exact.includes(bare) || exact.includes(route.routePath) || prefix.some((p) => bare.startsWith(p) || route.routePath.startsWith(p));
      return {
        authenticated: !isAllowlisted,
        source: "global-backstop",
        roleArgs: [],
        platformOnly: false,
        detail: isAllowlisted
          ? `matches global auth-gate allowlist entry @ ${mount.file}:${mount.line}`
          : `global auth-gate @ ${mount.file}:${mount.line} applies (not in its allowlist)`,
      };
    }
  }

  return { authenticated: false, source: "none-detected", roleArgs: [], platformOnly: false, detail: "no auth signal found (own args or inherited mount)" };
}

// ── Company/tenant scoping ────────────────────────────────────────────────────

const RE_CLIENT_QUERY = /req\.query(?:\?\.|\.)companyId\b|\{\s*[^}]*\bcompanyId\b[^}]*\}\s*=\s*req\.query\b/;
const RE_CLIENT_BODY = /req\.body(?:\?\.|\.)companyId\b|\{\s*[^}]*\bcompanyId\b[^}]*\}\s*=\s*req\.body\b/;
const RE_CLIENT_PARAMS = /req\.params(?:\?\.|\.)companyId\b|\{\s*[^}]*\bcompanyId\b[^}]*\}\s*=\s*req\.params\b/;
const RE_SESSION_DERIVED = /req\.resolvedCompanyId\b|getSessionCompanyId\(|req\.session(?:\?\.)?\.companyId\b|user\??\.companyId\b|req\.user(?:\?\.)?\.companyId\b/;
const RE_MEMBERSHIP_CHECK = /\bcanAccessCompany\(|\bassertUserCanAccessCompany\(/;
const RE_ENFORCE_SCOPE_MW = /enforceCompanyScope\(/;
const RE_PLATFORM_CHECK_INLINE = /isPlatformUser\(|isGlobalDiagnosticsRole\(/;

interface ScopeSignal {
  companyIdSources: string[];
  hasMembershipCheck: boolean;
  hasEnforceScopeMiddleware: boolean;
  clientSuppliedCompanyIdWithoutMembershipCheck: boolean;
}

function resolveScope(route: RawRoute): ScopeSignal {
  const body = route.handlerBodyText;
  const sources: string[] = [];
  if (RE_CLIENT_QUERY.test(body)) sources.push("query");
  if (RE_CLIENT_BODY.test(body)) sources.push("body");
  if (RE_CLIENT_PARAMS.test(body)) sources.push("url");
  if (RE_SESSION_DERIVED.test(body)) sources.push("session");

  const hasMembershipCheck = RE_MEMBERSHIP_CHECK.test(body);
  const hasEnforceScopeMiddleware = route.args.some((a) => a.kind === "call" && a.text.startsWith("enforceCompanyScope("));
  const clientSupplied = sources.includes("query") || sources.includes("body") || sources.includes("url");

  return {
    companyIdSources: sources,
    hasMembershipCheck,
    hasEnforceScopeMiddleware,
    clientSuppliedCompanyIdWithoutMembershipCheck: clientSupplied && !hasMembershipCheck && !hasEnforceScopeMiddleware,
  };
}

// ── Mutation / CSRF ────────────────────────────────────────────────────────────

function mutates(method: string): boolean {
  return method !== "GET";
}

// No CSRF middleware exists anywhere in this codebase today (confirmed by
// direct search — see the manifest doc §CSRF). Every mutating route is
// therefore "requires-classification" (not silently "fine") unless its path
// identifies it as a webhook/callback, which is protected by a different
// mechanism (signature/secret verification) instead of session-cookie CSRF.
function csrfClassification(routePath: string, category: string, mutating: boolean): "not-applicable" | "webhook-signature-not-csrf" | "unprotected-needs-classification" {
  if (!mutating) return "not-applicable";
  if (category === "webhook/integration callback") return "webhook-signature-not-csrf";
  return "unprotected-needs-classification";
}

// ── Category classification ───────────────────────────────────────────────────

const HEALTH_RE = /\/(health|healthz|ready|readyz|live|liveness|version|diagnostics|app-doctor|_internal|_debug)\b/i;
const WEBHOOK_RE = /webhook|\/callback\b|oauth\/tiktok\/callback|\/sms\b.*webhook/i;
const TOKEN_PATH_RE = /:token\b|\/sign\/|\/verify\b|\/portal\/:|\/pay\/:token|magic-link|^\/api\/pay\/|^\/api\/payments\/stripe-status\//i;
// Capability/opaque-token check performed *inside* the handler body rather than
// implied by the URL shape (e.g. /api/portal/proposals/:id?token=... validated
// via validatePortalToken(...)) — path alone would under-detect these as
// "public anonymous" instead of "public token-protected".
const RE_INLINE_TOKEN_CHECK = /validatePortalToken\(|getPortalAccessTokenByToken\(|req\.(query|params|body)(?:\?\.)?\.(token|accessToken|shareToken|magicToken)\b|\{\s*token\b[^}]*\}\s*=\s*req\.(query|body|params)\b/;
const LEGACY_RE = /deprecated|legacy/i;

// Hand-reviewed exceptions for the handful of session-establishment/auth-boundary
// routes that are registered before any auth signal exists in the file (by
// necessity — you cannot require a session to create one) and so cannot be
// classified by the generic auth-signal heuristic above. Every entry here is a
// documented exception with a human-written justification, checked by
// tests/route-manifest-exception-justification.test.ts.
const MANUAL_OVERRIDES: Record<string, { category: Category; justification: string }> = {
  "POST /api/auth/login": {
    category: "public anonymous",
    justification: "Credential-based session-establishment endpoint; must be reachable with no prior session by definition.",
  },
  "POST /api/auth/logout": {
    category: "public anonymous",
    justification: "Destroys whatever session (if any) exists; safe and necessary to allow with no prior session.",
  },
  "POST /api/auth/mfa/login-verify": {
    category: "public anonymous",
    justification: "Second factor of the login flow; runs before a full session exists (verifies a short-lived pending-MFA session state, not a normal session).",
  },
  "POST /api/auth/recover": {
    category: "public token-protected",
    justification: "Gates on a mailed/issued recoveryToken value read from the request body, not a session cookie.",
  },
  "POST /api/auth/pin-login": {
    category: "public anonymous",
    justification: "Alternate credential-based session-establishment endpoint (employee PIN); pre-session by definition.",
  },
  "GET /api/auth/me": {
    category: "authenticated global/self-service",
    justification: "Checks req.session.userId inline (401 if absent) rather than via requireAuth middleware; functionally equivalent gating, returns the caller's own identity only.",
  },
};

type Category =
  | "public anonymous"
  | "public token-protected"
  | "authenticated global/self-service"
  | "authenticated tenant-scoped"
  | "platform-console only"
  | "webhook/integration callback"
  | "internal diagnostics/health"
  | "deprecated/legacy"
  | "unclassified — merge-blocking";

function classify(
  route: RawRoute,
  auth: AuthSignal,
  scope: ScopeSignal
): { category: Category; justification: string | null; confidence: "high" | "medium" | "low" } {
  const p = route.routePath;
  const overrideKey = `${route.method} ${p}`;
  if (MANUAL_OVERRIDES[overrideKey]) {
    const o = MANUAL_OVERRIDES[overrideKey];
    return { category: o.category, justification: o.justification, confidence: "high" };
  }

  if (LEGACY_RE.test(route.leadingComment) || LEGACY_RE.test(p)) {
    return {
      category: "deprecated/legacy",
      justification: route.leadingComment || "path/comment marks this route deprecated/legacy",
      confidence: "high",
    };
  }

  if (WEBHOOK_RE.test(p)) {
    return { category: "webhook/integration callback", justification: "path identifies an external callback/webhook endpoint", confidence: "high" };
  }

  if (HEALTH_RE.test(p)) {
    return { category: "internal diagnostics/health", justification: "path identifies an internal health/diagnostics endpoint", confidence: "high" };
  }

  if (auth.source === "none-detected") {
    return { category: "unclassified — merge-blocking", justification: null, confidence: "low" };
  }

  if (!auth.authenticated) {
    if (TOKEN_PATH_RE.test(p) || RE_INLINE_TOKEN_CHECK.test(route.handlerBodyText)) {
      return {
        category: "public token-protected",
        justification: `no session auth required; ${RE_INLINE_TOKEN_CHECK.test(route.handlerBodyText) ? "handler validates an opaque token/capability value from the request" : "path shape implies a bearer-token/opaque-link access model"} (${auth.detail})`,
        confidence: "medium",
      };
    }
    return {
      category: "public anonymous",
      justification: `no session auth required (${auth.detail})`,
      confidence: auth.source === "global-backstop" ? "high" : "medium",
    };
  }

  if (auth.platformOnly || (auth.roleArgs.length > 0 && auth.roleArgs.every((r) => r.startsWith("platform_")))) {
    return { category: "platform-console only", justification: `requires an explicit platform_* role (${auth.detail})`, confidence: "high" };
  }

  const hasAnyScopeSignal = scope.companyIdSources.length > 0 || scope.hasEnforceScopeMiddleware;
  if (hasAnyScopeSignal) {
    return { category: "authenticated tenant-scoped", justification: null, confidence: "medium" };
  }

  return { category: "authenticated global/self-service", justification: null, confidence: "low" };
}

// ── Manifest entry ─────────────────────────────────────────────────────────────

interface ManifestEntry {
  id: string;
  method: string;
  path: string;
  source: string;
  category: Category;
  justification: string | null;
  auth: {
    authenticated: boolean;
    resolutionSource: string;
    detail: string;
    roleArgs: string[];
  };
  companyContext: {
    sources: string[];
    hasMembershipCheck: boolean;
    hasEnforceScopeMiddleware: boolean;
  };
  mutates: boolean;
  csrf: string;
  findings: {
    clientSuppliedCompanyIdWithoutMembershipCheck: boolean;
  };
  confidence: "high" | "medium" | "low";
}

function buildManifest(): { generatedAt: string; version: number; routeCount: number; entries: ManifestEntry[] } {
  const rawRoutes = ROUTE_FILES.flatMap((f) => extractFromFile(f));
  const mounts = ROUTE_FILES.flatMap((f) => extractMounts(f));

  const entries: ManifestEntry[] = rawRoutes.map((route) => {
    const auth = resolveAuth(route, mounts);
    const scope = resolveScope(route);
    const { category, justification, confidence } = classify(route, auth, scope);
    const mutating = mutates(route.method);
    return {
      id: `${route.method} ${route.routePath}`,
      method: route.method,
      path: route.routePath,
      source: `${route.file}:${route.line}`,
      category,
      justification,
      auth: {
        authenticated: auth.authenticated,
        resolutionSource: auth.source,
        detail: auth.detail,
        roleArgs: auth.roleArgs,
      },
      companyContext: {
        sources: scope.companyIdSources,
        hasMembershipCheck: scope.hasMembershipCheck,
        hasEnforceScopeMiddleware: scope.hasEnforceScopeMiddleware,
      },
      mutates: mutating,
      csrf: csrfClassification(route.routePath, category, mutating),
      findings: {
        clientSuppliedCompanyIdWithoutMembershipCheck: scope.clientSuppliedCompanyIdWithoutMembershipCheck,
      },
      confidence,
    };
  });

  entries.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : a.source.localeCompare(b.source)));

  return {
    generatedAt: new Date().toISOString().slice(0, 10),
    version: MANIFEST_VERSION,
    routeCount: entries.length,
    entries,
  };
}

function main() {
  const mode = process.argv[2];
  const manifest = buildManifest();

  if (mode === "--check") {
    if (!fs.existsSync(MANIFEST_PATH)) {
      console.error(`FAIL: ${MANIFEST_PATH} does not exist. Run: tsx scripts/route-inventory/classify-routes.ts --write`);
      process.exit(1);
    }
    const committed = JSON.parse(fs.readFileSync(MANIFEST_PATH, "utf8"));
    const committedIds = new Set<string>(committed.entries.map((e: ManifestEntry) => e.id));
    const currentIds = new Set<string>(manifest.entries.map((e) => e.id));

    const missing = [...currentIds].filter((id) => !committedIds.has(id));
    const stale = [...committedIds].filter((id) => !currentIds.has(id));

    if (missing.length > 0 || stale.length > 0) {
      console.error("FAIL: route-security-manifest.json is out of date with server source.");
      if (missing.length) console.error(`  Routes in source but missing from manifest (${missing.length}):`, missing.slice(0, 20));
      if (stale.length) console.error(`  Routes in manifest but no longer in source (${stale.length}):`, stale.slice(0, 20));
      console.error("  Run: tsx scripts/route-inventory/classify-routes.ts --write");
      process.exit(1);
    }
    console.log(`OK: manifest is current — ${manifest.routeCount} routes, all present and accounted for.`);
    process.exit(0);
  }

  if (mode === "--write") {
    fs.writeFileSync(MANIFEST_PATH, JSON.stringify(manifest, null, 2) + "\n");
    console.log(`Wrote ${MANIFEST_PATH} — ${manifest.routeCount} routes.`);
    process.exit(0);
  }

  console.log(JSON.stringify(manifest, null, 2));
}

main();
