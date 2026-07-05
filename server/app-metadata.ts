import { sql } from "drizzle-orm";

export type AppEnvironment = "production" | "staging" | "development";

const ALLOWED_APP_ENVS = new Set<AppEnvironment>(["production", "staging", "development"]);

export function getAppEnvironment(): AppEnvironment {
  const raw = process.env.APP_ENV || process.env.NODE_ENV || "development";
  return ALLOWED_APP_ENVS.has(raw as AppEnvironment) ? (raw as AppEnvironment) : "development";
}

export function getAppVersion(): string {
  return process.env.APP_VERSION || "2.1.1";
}

export function getCommitHash(): string {
  return process.env.PAYLINK_COMMIT || process.env.COMMIT_SHA || process.env.GITHUB_SHA || "unknown";
}

export async function getDatabaseHealth(): Promise<"connected" | "unavailable"> {
  try {
    const { db } = await import("./db");
    await db.execute(sql`SELECT 1`);
    return "connected";
  } catch (err: any) {
    console.error("[Health] Database check failed:", err?.message || err);
    return "unavailable";
  }
}

export async function getHealthPayload() {
  return {
    status: "ok",
    environment: getAppEnvironment(),
    version: getAppVersion(),
    commit: getCommitHash(),
    database: await getDatabaseHealth(),
    timestamp: new Date().toISOString(),
  };
}
