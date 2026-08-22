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
 */
import { spawn, type ChildProcess } from "node:child_process";
import net from "node:net";

export interface TestServer {
  baseUrl: string;
  stop(): Promise<void>;
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

/**
 * Starts server/index.ts as a child process bound to a random free
 * 127.0.0.1 port, using the given disposable database URL. The caller must
 * have already validated that URL (forbidden-pattern / DATABASE_URL-equality
 * checks) before calling this — this harness does not re-validate it.
 */
export async function startTestServer(testDatabaseUrl: string): Promise<TestServer> {
  const port = await getFreePort();
  const child: ChildProcess = spawn("npx", ["tsx", "server/index.ts"], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      DATABASE_URL: testDatabaseUrl,
      SESSION_SECRET: "phase-0.5s-test-harness-secret-not-used-anywhere-real",
      NODE_ENV: "development",
      PORT: String(port),
      APP_ENV: "development",
    },
    stdio: ["ignore", "pipe", "pipe"],
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
    child.kill("SIGKILL");
    throw e;
  }

  return {
    baseUrl,
    async stop() {
      await new Promise<void>((resolve) => {
        const timeout = setTimeout(() => {
          child.kill("SIGKILL");
          resolve();
        }, 8000);
        child.once("exit", () => {
          clearTimeout(timeout);
          resolve();
        });
        child.kill("SIGTERM");
      });
    },
  };
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
