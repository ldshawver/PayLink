import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "@shared/schema";

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
});

pool.on("connect", (client) => {
  client.query("SET timezone = 'UTC'").catch((err) =>
    console.error("[db] Failed to set session timezone to UTC:", err)
  );
});

export const db = drizzle(pool, { schema });
