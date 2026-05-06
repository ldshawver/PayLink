import path from "path";

/**
 * Resolve a DAM document `file_path` (as stored in the database) to a safe
 * absolute filesystem path under `root`. Returns `null` if the path would
 * escape the repo root (traversal protection).
 *
 * The DB stores a mix of formats:
 *   - app/web-relative: "/uploads/foo.pdf" (most common; what generators write)
 *   - repo-relative: "uploads/foo.pdf"
 *   - true OS-absolute: "/abs/legacy/foo.pdf" (legacy; only allowed if inside root)
 *
 * Any leading single "/" is treated as web-relative and stripped before
 * resolving against `root`. A leading "//" (UNC-style) is treated as
 * OS-absolute. The final resolved path is required to live under `root`.
 */
export function resolveDamFilePath(rawPath: string, root: string): string | null {
  if (!rawPath) return null;
  // 1. If it's an OS-absolute path that already lives under `root`, honor it.
  if (path.isAbsolute(rawPath)) {
    const abs = path.resolve(rawPath);
    if (abs === root || abs.startsWith(root + path.sep)) return abs;
    // Otherwise fall through and treat the leading "/" as web-relative.
  }
  // 2. Treat as web/repo-relative under `root`. Strips any leading slashes
  //    so "/uploads/foo.pdf" -> "<root>/uploads/foo.pdf".
  const stripped = rawPath.replace(/^\/+/, "");
  const resolved = path.resolve(root, stripped);
  if (resolved !== root && !resolved.startsWith(root + path.sep)) return null;
  return resolved;
}
