/**
 * Phase 0.5s test harness: boots the real application server
 * (server/index.ts, unmodified) as a child process against a caller-supplied
 * disposable Postgres database, waits for /health to report ready, and
 * exposes a minimal login/request helper for exercising real HTTP routes
 * with real sessions.
 *
 * SAFETY: this module never logs the database connection string, session
 * cookies, or any request/response body it is given. Callers are
 * responsible for not logging sensitive fixture data themselves.
 *
 * PROCESS LIFECYCLE (Phase 0.5 test-harness-cleanup): the spawned server is
 * always the leader of its own POSIX process group, and stop() always
 * signals that whole group — see spawnManagedProcess() below for why and
 * how.
 */
import { spawn, type ChildProcess } from "node:child_process";
import { createRequire } from "node:module";
import net from "node:net";
import path from "node:path";

const require = createRequire(import.meta.url);

/**
 * Resolves the absolute path to the repository's installed tsx CLI entry
 * point (node_modules/tsx/dist/cli.mjs), so it can be run as
 * `node <cli.mjs> <script>` instead of `npx tsx <script>`.
 *
 * Root cause this replaces: `spawn("npx", ["tsx", ...])` makes npx's own
 * process the tracked child. npx resolves "tsx" and execs it as a further
 * child of itself, but does not reliably forward SIGTERM to that child —
 * killing the tracked npx process only kills npx; the actual tsx process
 * (and the node process tsx itself spawns to apply its loader flags) is
 * reparented to init and keeps running, still holding its port. Invoking
 * tsx's own entry point directly removes the npx wrapper layer, so the
 * process spawnManagedProcess() tracks is tsx itself, not a wrapper around
 * it — reproduced and verified fixed during this branch's Phase 1.
 */
export function resolveTsxCliPath(): string {
  const pkgJsonPath = require.resolve("tsx/package.json");
  const pkg = require(pkgJsonPath) as { bin: string };
  return path.join(path.dirname(pkgJsonPath), pkg.bin);
}

function getFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.listen(0, "127.0.0.1", () => {
      const address = srv.address();
      if (address && typeof address === "object") {
        const port = address.port;
        srv.close(() => resolve(port));
      } else {
        srv.close(() => reject(new Error("could not determine a free port")));
      }
    });
    srv.on("error", reject);
  });
}

async function waitForHealth(baseUrl: string, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${baseUrl}/health`);
      if (res.ok) return;
    } catch (e) {
      lastError = e;
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error(`Test server did not become healthy within ${timeoutMs}ms: ${lastError instanceof Error ? lastError.message : String(lastError)}`);
}

export interface ManagedProcess {
  pid: number;
  /** Idempotent — safe to call more than once, including concurrently. */
  stop(): Promise<void>;
}

/**
 * Spawns `command args...` as the leader of its own POSIX process group
 * (`detached: true`, so the new group's id equals the child's own pid), and
 * returns a handle whose stop() tears down that *entire* group, not just
 * the one tracked pid.
 *
 * Why a process group and not just the tracked pid: a spawned script can
 * itself spawn further descendants (tsx's cli.mjs does exactly this, to
 * apply loader flags that can only be set at node startup). A plain
 * `child.kill()` only ever reaches the one process Node gave us a handle
 * for. Any descendant the tracked process spawns via a normal (non-
 * detached) child_process call inherits the *same* process group by
 * default, so `process.kill(-pid, signal)` — the POSIX "signal the whole
 * group" form — reaches the tracked process and everything it spawned,
 * without needing to enumerate or track those descendants individually.
 *
 * stop() sends SIGTERM to the group first, waits up to `stopGraceMs` for
 * the tracked process to report exit, and escalates to SIGKILL only if it
 * is still alive after that grace period. An already-exited process is
 * treated as successful cleanup with no signal sent. stop() is idempotent
 * (repeated/concurrent calls share one in-flight cleanup) and also
 * installs SIGINT/SIGTERM forwarding on the *caller's own* process for the
 * lifetime of the managed child, so an interrupted caller still tears down
 * what it started before exiting; that forwarding is uninstalled as part
 * of stop() so it never outlives the managed process or leaks across
 * repeated calls.
 *
 * win32 has no POSIX process-group signal; falls back to signaling the
 * tracked process directly there. This harness only runs in this
 * repository's Linux CI/dev environments.
 */
export function spawnManagedProcess(
  command: string,
  args: string[],
  options: { cwd: string; env: NodeJS.ProcessEnv; stdio?: ["ignore", "pipe", "pipe"]; stopGraceMs?: number },
): { child: ChildProcess; managed: ManagedProcess } {
  const stopGraceMs = options.stopGraceMs ?? 8000;
  const child = spawn(command, args, {
    cwd: options.cwd,
    env: options.env,
    stdio: options.stdio ?? ["ignore", "pipe", "pipe"],
    detached: process.platform !== "win32",
  });
  if (child.pid == null) {
    throw new Error(`Failed to spawn managed process: ${command} ${args.join(" ")}`);
  }
  const pid = child.pid;

  // Without a listener, a spawn-level error (e.g. ENOENT) is an uncaught
  // 'error' event and crashes the caller. Callers that need to know about a
  // failed spawn observe it via the child's 'exit' event instead (see
  // startTestServer's exitedEarly race).
  child.on("error", () => {});

  let exited = false;
  child.once("exit", () => {
    exited = true;
  });

  function signalGroup(signal: NodeJS.Signals): void {
    try {
      if (process.platform === "win32") {
        child.kill(signal);
      } else {
        process.kill(-pid, signal);
      }
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "ESRCH") {
        try {
          child.kill(signal);
        } catch {
          // already gone
        }
      }
    }
  }

  let uninstallSignalForwarding: (() => void) | null = null;
  let stopPromise: Promise<void> | null = null;

  function stop(): Promise<void> {
    if (stopPromise) return stopPromise;
    stopPromise = (async () => {
      uninstallSignalForwarding?.();
      uninstallSignalForwarding = null;
      if (!exited) {
        await new Promise<void>((resolve) => {
          const timeout = setTimeout(() => {
            signalGroup("SIGKILL");
            // Give SIGKILL a moment to land; a group whose exit we can no
            // longer observe (e.g. already reaped elsewhere) must not hang
            // cleanup forever.
            setTimeout(resolve, 500);
          }, stopGraceMs);
          child.once("exit", () => {
            clearTimeout(timeout);
            resolve();
          });
          signalGroup("SIGTERM");
        });
      }
      child.removeAllListeners();
      child.stdout?.removeAllListeners();
      child.stderr?.removeAllListeners();
    })();
    return stopPromise;
  }

  const onSignal = (signal: NodeJS.Signals) => {
    void stop().finally(() => {
      process.exit(signal === "SIGINT" ? 130 : 143);
    });
  };
  process.on("SIGINT", onSignal);
  process.on("SIGTERM", onSignal);
  uninstallSignalForwarding = () => {
    process.removeListener("SIGINT", onSignal);
    process.removeListener("SIGTERM", onSignal);
  };

  return { child, managed: { pid, stop } };
}

export interface TestServer {
  baseUrl: string;
  stop(): Promise<void>;
}

/**
 * Starts server/index.ts as a managed child process (see
 * spawnManagedProcess) bound to a random free 127.0.0.1 port, using the
 * given disposable database URL. The caller must have already validated
 * that URL (forbidden-pattern / DATABASE_URL-equality checks) before
 * calling this — this harness does not re-validate it.
 */
export async function startTestServer(testDatabaseUrl: string): Promise<TestServer> {
  const port = await getFreePort();
  const tsxCliPath = resolveTsxCliPath();
  const { child, managed } = spawnManagedProcess(process.execPath, [tsxCliPath, "server/index.ts"], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      DATABASE_URL: testDatabaseUrl,
      SESSION_SECRET: "phase-0.5s-test-harness-secret-not-used-anywhere-real",
      NODE_ENV: "development",
      PORT: String(port),
      APP_ENV: "development",
    },
  });

  const stderrLines: string[] = [];
  child.stderr?.on("data", (chunk: Buffer) => {
    stderrLines.push(chunk.toString());
    if (stderrLines.length > 200) stderrLines.shift();
  });

  const baseUrl = `http://127.0.0.1:${port}`;

  const exitedEarly = new Promise<never>((_, reject) => {
    child.once("exit", (code, signal) => {
      reject(new Error(`Test server exited early (code=${code}, signal=${signal}). Last stderr:\n${stderrLines.slice(-40).join("")}`));
    });
  });

  try {
    await Promise.race([waitForHealth(baseUrl, 30_000), exitedEarly]);
  } catch (e) {
    await managed.stop();
    throw e;
  }

  return { baseUrl, stop: managed.stop };
}

/** Extracts just the `connect.sid=...` cookie pair from a Set-Cookie header, discarding attributes. */
function extractSessionCookie(setCookieHeader: string | null): string | null {
  if (!setCookieHeader) return null;
  const match = setCookieHeader.match(/connect\.sid=[^;]+/);
  return match ? match[0] : null;
}

export interface Session {
  cookie: string;
  userId: string;
  role: string;
}

/** Logs in via the real POST /api/auth/login route and returns a reusable session cookie. Never logs the cookie or password. */
export async function login(baseUrl: string, username: string, password: string): Promise<Session> {
  const res = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username, password }),
  });
  if (!res.ok) {
    throw new Error(`Login failed for a test fixture user (status ${res.status}) — see route response for the reason, no credentials logged here.`);
  }
  const cookie = extractSessionCookie(res.headers.get("set-cookie"));
  if (!cookie) throw new Error("Login succeeded but no session cookie was returned.");
  const body = (await res.json()) as { id: string; role: string };
  return { cookie, userId: body.id, role: body.role };
}

export interface ApiResult {
  status: number;
  body: unknown;
}

export async function apiRequest(baseUrl: string, method: string, path: string, session: Session | null, jsonBody?: unknown): Promise<ApiResult> {
  const headers: Record<string, string> = {};
  if (session) headers["cookie"] = session.cookie;
  if (jsonBody !== undefined) headers["content-type"] = "application/json";
  const res = await fetch(`${baseUrl}${path}`, {
    method,
    headers,
    body: jsonBody !== undefined ? JSON.stringify(jsonBody) : undefined,
  });
  let body: unknown;
  try {
    body = await res.json();
  } catch {
    body = undefined;
  }
  return { status: res.status, body };
}
