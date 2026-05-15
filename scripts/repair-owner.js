/**
 * repair-owner.js — Owner login repair utility
 * Run with: node scripts/repair-owner.js --username=admin --password='YourPass'
 */
"use strict";

// Load env from /etc/paylink/.env if present, then fall back to .env
try { require("dotenv").config({ path: "/etc/paylink/.env" }); } catch (_) {}
try { require("dotenv").config(); } catch (_) {}

const { Pool } = require("pg");
const bcrypt = require("bcrypt");

const args = {};
for (const arg of process.argv.slice(2)) {
  const eq = arg.indexOf("=");
  if (eq !== -1) {
    const key = arg.slice(0, eq).replace(/^--/, "");
    args[key] = arg.slice(eq + 1);
  }
}

const username = args["username"];
const password = args["password"];

if (!username || !password) {
  console.error("Usage: node scripts/repair-owner.js --username=<user> --password=<pass>");
  process.exit(1);
}

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function main() {
  const client = await pool.connect();
  try {
    const { rows } = await client.query(
      "SELECT id, username, role, company_id, is_active FROM users WHERE username = $1",
      [username]
    );

    if (rows.length === 0) {
      console.error(`ERROR: No user found with username "${username}"`);
      process.exit(1);
    }

    const user = rows[0];
    const hash = await bcrypt.hash(password, 12);

    await client.query(
      `UPDATE users
       SET role            = 'platform_super_admin',
           company_id      = NULL,
           is_active       = true,
           mfa_enabled     = false,
           totp_secret     = NULL,
           mfa_enforced_at = NULL,
           password        = $1
       WHERE id = $2`,
      [hash, user.id]
    );

    console.log(`OK: user "${user.username}" repaired`);
    console.log(`    role      -> platform_super_admin`);
    console.log(`    company   -> NULL (global scope)`);
    console.log(`    active    -> true`);
    console.log(`    mfa       -> cleared`);
    console.log(`    password  -> updated`);
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((err) => {
  console.error("FAILED:", err.message);
  process.exit(1);
});
