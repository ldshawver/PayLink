/**
 * Regression test for /api/dam-documents/:id/download path normalization.
 * The DB stores app-relative web paths like "/uploads/foo.pdf" — those
 * MUST resolve to <root>/uploads/foo.pdf, not be treated as OS-absolute
 * and rejected as outside the repo.
 *
 * Run: npx tsx tests/dam-paths.test.ts
 */
import path from "path";
import { resolveDamFilePath } from "../server/dam-paths";

let pass = 0;
let fail = 0;
const log = (name: string, ok: boolean, detail?: string) => {
  if (ok) { pass++; console.log(`  \u2713 ${name}`); }
  else    { fail++; console.error(`  \u2717 ${name}${detail ? ` \u2014 ${detail}` : ""}`); }
};

const root = "/home/runner/workspace";

console.log("=== DAM file_path resolver tests ===\n");

// 1. Web-relative paths (most common): leading single slash means /<root>/<rest>
log(
  "/uploads/foo.pdf -> <root>/uploads/foo.pdf",
  resolveDamFilePath("/uploads/foo.pdf", root) === path.join(root, "uploads/foo.pdf"),
  String(resolveDamFilePath("/uploads/foo.pdf", root))
);
log(
  "/uploads/proposals/abc/file.pdf -> joined under root",
  resolveDamFilePath("/uploads/proposals/abc/file.pdf", root) ===
    path.join(root, "uploads/proposals/abc/file.pdf"),
);

// 2. Repo-relative paths
log(
  "uploads/bar.pdf -> <root>/uploads/bar.pdf",
  resolveDamFilePath("uploads/bar.pdf", root) === path.join(root, "uploads/bar.pdf"),
);

// 3. Traversal attempts must be rejected
log("../etc/passwd is rejected", resolveDamFilePath("../etc/passwd", root) === null);
log("/uploads/../../etc/passwd is rejected", resolveDamFilePath("/uploads/../../etc/passwd", root) === null);
// /etc/passwd: not under root as OS-absolute, falls back to web-relative
// and resolves to <root>/etc/passwd. That path doesn't escape `root`, so the
// resolver returns it; the caller's fs.existsSync check then 404s. This is
// safe — the resolver only blocks paths that escape `root`, not paths that
// happen not to exist.
log(
  "/etc/passwd resolves under root (caller existence-checks)",
  resolveDamFilePath("/etc/passwd", root) === path.join(root, "etc/passwd"),
);

// 4. OS-absolute paths INSIDE root are accepted
log(
  "absolute path inside root is accepted",
  resolveDamFilePath(path.join(root, "uploads/x.pdf"), root) === path.join(root, "uploads/x.pdf"),
);

// 5. Empty / falsy input
log("empty string -> null", resolveDamFilePath("", root) === null);

console.log(`\n=== ${pass} passed, ${fail} failed ===`);
process.exit(fail === 0 ? 0 : 1);
