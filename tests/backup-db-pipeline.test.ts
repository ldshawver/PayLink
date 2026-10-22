/**
 * PB-1 — production DB backup pipeline, end to end against disposable infrastructure.
 * Run: npx tsx tests/backup-db-pipeline.test.ts
 *
 * Builds everything it touches inside one temp dir and deletes it afterwards:
 *   - a throwaway PostgreSQL cluster (initdb, 127.0.0.1 random port, scram password)
 *   - an "admin" gpg keyring (private key, i.e. the offline key) and a "server"
 *     keyring holding only the public key — exactly the production split
 *   - an rclone `local` remote standing in for the off-server bucket
 *   - an HTTP listener capturing healthcheck pings
 * Requires PostgreSQL server binaries (PAYLINK_PG_BINDIR or /usr/lib/postgresql/<v>/bin),
 * gpg, rclone, python3. Never connects to any pre-existing database.
 *
 * Pins:
 *   - success: encrypted dump + sha256 + manifest locally AND off-server, hashes match,
 *     no plaintext dump left anywhere, server keyring cannot decrypt, admin keyring can,
 *     restore drill of the OFF-SERVER copy reproduces the source row counts;
 *   - the DB password never reaches logs; start + success pings, no /fail;
 *   - failures (bad DB password, missing gpg key config, unreachable remote, corrupt
 *     dump) exit non-zero, ping /fail, update no last-success marker and leave no
 *     partial or plaintext files;
 *   - retention prunes only this script's old files, never pre-deploy dumps;
 *     remote prune is opt-in and refuses < 7 days.
 */
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import net from "node:net";
import os from "node:os";
import path from "node:path";

let pass = 0, fail = 0;
const ok = (name: string, cond: boolean, detail?: string) => {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.error(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`); }
};

const REPO = process.cwd();

const pgBinDir = process.env.PAYLINK_PG_BINDIR ||
  (fs.existsSync("/usr/lib/postgresql")
    ? fs.readdirSync("/usr/lib/postgresql").sort((a, b) => Number(a) - Number(b))
        .map((v) => `/usr/lib/postgresql/${v}/bin`).filter((d) => fs.existsSync(`${d}/initdb`)).pop()
    : undefined);
for (const [what, present] of [
  ["PostgreSQL server binaries", !!pgBinDir],
  ["gpg", spawnSync("gpg", ["--version"]).status === 0],
  ["rclone", spawnSync("rclone", ["version"]).status === 0],
] as const) {
  if (!present) { console.error(`prerequisite missing: ${what}`); process.exit(1); }
}

// initdb refuses root: when run as root, every command runs as `nobody` in a dir it owns.
const asRoot = process.getuid?.() === 0;
const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), "paylink-backup-test-"));
fs.chmodSync(ROOT, 0o755);
if (asRoot) spawnSync("chown", ["nobody:nogroup", ROOT]);
const P = (...p: string[]) => path.join(ROOT, ...p);
// Install the script pair side by side, as production does (/usr/local/lib/paylink-backup/).
fs.mkdirSync(P("bin"));
for (const f of ["backup-db.sh", "backup-restore-verify.sh"]) {
  fs.copyFileSync(path.join(REPO, "scripts", f), P("bin", f));
  fs.chmodSync(P("bin", f), 0o755);
}
const BACKUP_SCRIPT = P("bin", "backup-db.sh");
const VERIFY_SCRIPT = P("bin", "backup-restore-verify.sh");
const SECRET_PW = "s3cret-Pw:with@special/chars";
const CANARY = "PB1-CANARY-ACME-PAYROLL-7731";

type Run = { code: number; out: string };
function run(cmd: string, env: Record<string, string> = {}): Promise<Run> {
  const fullEnv: Record<string, string> = {
    PATH: `${pgBinDir}:/usr/local/bin:/usr/bin:/bin`,
    HOME: ROOT, TMPDIR: P("tmp"), LANG: "C.UTF-8", ...env,
  };
  const argv = asRoot
    ? ["/usr/sbin/runuser", "-u", "nobody", "--", "/usr/bin/env", ...Object.entries(fullEnv).map(([k, v]) => `${k}=${v}`), "bash", "-c", cmd]
    : ["bash", "-c", cmd];
  return new Promise((resolve) => {
    const child = spawn(argv[0], argv.slice(1), { env: asRoot ? {} : fullEnv, cwd: ROOT });
    let out = "";
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (out += d));
    child.on("close", (code) => resolve({ code: code ?? -1, out }));
  });
}
async function must(cmd: string, env: Record<string, string> = {}): Promise<string> {
  const r = await run(cmd, env);
  if (r.code !== 0) throw new Error(`setup command failed (${r.code}): ${cmd}\n${r.out}`);
  return r.out;
}
const freePort = () => new Promise<number>((resolve) => {
  const s = net.createServer().listen(0, "127.0.0.1", () => {
    const p = (s.address() as net.AddressInfo).port; s.close(() => resolve(p));
  });
});
const walk = (dir: string): string[] => fs.existsSync(dir)
  ? fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
      e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)])
  : [];

async function main() {
  // ---------------------------------------------------------------- setup
  await must(`mkdir -p tmp src remote local admin-gnupg server-gnupg && chmod 700 admin-gnupg server-gnupg`);
  const dbPort = await freePort();
  fs.writeFileSync(P("pw"), SECRET_PW);
  if (asRoot) spawnSync("chown", ["nobody:nogroup", P("pw")]);
  await must(`initdb -D src/data -U paylink_app --auth=scram-sha-256 --pwfile=pw >/dev/null`);
  await must(`pg_ctl -D src/data -w -l src/log -o "-c listen_addresses=127.0.0.1 -c port=${dbPort} -c unix_socket_directories=${P("src")}" start >/dev/null`);
  const SQL = `
    CREATE TABLE companies (id serial PRIMARY KEY, name text NOT NULL);
    CREATE TABLE users (id serial PRIMARY KEY, company_id int REFERENCES companies(id), email text);
    CREATE TABLE workers (id serial PRIMARY KEY, company_id int REFERENCES companies(id), ssn_last4 text, note text);
    CREATE TABLE payroll_items (id serial PRIMARY KEY, worker_id int REFERENCES workers(id), amount numeric(12,2));
    CREATE TABLE empty_audit (id serial PRIMARY KEY);
    INSERT INTO companies (name) SELECT 'Company ' || g FROM generate_series(1, 3) g;
    INSERT INTO users (company_id, email) SELECT 1 + g % 3, 'u' || g || '@example.test' FROM generate_series(1, 25) g;
    INSERT INTO workers (company_id, ssn_last4, note) SELECT 1 + g % 3, lpad(g::text, 4, '0'), '${CANARY}' FROM generate_series(1, 40) g;
    INSERT INTO payroll_items (worker_id, amount) SELECT 1 + g % 40, g * 10.5 FROM generate_series(1, 500) g;`;
  fs.writeFileSync(P("seed.sql"), SQL);
  await must(`PGPASSWORD='${SECRET_PW}' psql -X -q -v ON_ERROR_STOP=1 -h 127.0.0.1 -p ${dbPort} -U paylink_app -d postgres -c "CREATE DATABASE paylink_src" && PGPASSWORD='${SECRET_PW}' psql -X -q -v ON_ERROR_STOP=1 -h 127.0.0.1 -p ${dbPort} -U paylink_app -d paylink_src -f seed.sql`);

  // offline key (admin) vs server keyring (public only)
  await must(`GNUPGHOME=admin-gnupg gpg --batch --pinentry-mode loopback --passphrase '' --quick-gen-key 'PayLink Backup Test <backup-test@example.test>' rsa3072 encrypt never 2>/dev/null`);
  const fpr = (await must(`GNUPGHOME=admin-gnupg gpg --batch --with-colons --list-keys 2>/dev/null | awk -F: '$1=="fpr"{print $10; exit}'`)).trim();
  await must(`GNUPGHOME=admin-gnupg gpg --batch --export ${fpr} | GNUPGHOME=server-gnupg gpg --batch --import 2>/dev/null`);
  ok("test key generated and public half imported into server keyring", /^[0-9A-F]{40}$/.test(fpr), fpr);

  fs.writeFileSync(P("rclone.conf"), `[offsite]\ntype = local\n`);
  const encodedPw = encodeURIComponent(SECRET_PW);
  fs.writeFileSync(P("app.env"), [
    `NODE_ENV=production`,
    `DATABASE_URL="postgresql://paylink_app:${encodedPw}@127.0.0.1:${dbPort}/paylink_src"`,
    `SESSION_SECRET=not-read-by-backup`,
  ].join("\n") + "\n");

  const pings: string[] = [];
  const hc = http.createServer((req, res) => { pings.push(req.url || ""); req.resume(); res.end("OK"); });
  await new Promise<void>((r) => hc.listen(0, "127.0.0.1", () => r()));
  const hcPort = (hc.address() as net.AddressInfo).port;

  const writeBackupEnv = (over: Record<string, string> = {}) => {
    const base: Record<string, string> = {
      PAYLINK_BACKUP_LABEL: "prod",
      PAYLINK_BACKUP_DIR: P("local"),
      PAYLINK_BACKUP_LOCAL_RETAIN_DAYS: "14",
      PAYLINK_BACKUP_GPG_RECIPIENT: fpr,
      PAYLINK_BACKUP_GNUPGHOME: P("server-gnupg"),
      PAYLINK_BACKUP_RCLONE_REMOTE: `offsite:${P("remote")}/prod`,
      PAYLINK_BACKUP_RCLONE_CONFIG: P("rclone.conf"),
      PAYLINK_BACKUP_MIN_TABLES: "5",
      PAYLINK_BACKUP_REQUIRE_ROWS: "companies users workers",
      PAYLINK_BACKUP_HEALTHCHECK_URL: `http://127.0.0.1:${hcPort}/hc`,
      ...over,
    };
    fs.writeFileSync(P("backup.env"), Object.entries(base).filter(([, v]) => v !== "").map(([k, v]) => `${k}=${v}`).join("\n") + "\n");
  };
  for (const f of ["app.env", "rclone.conf", "seed.sql"]) if (asRoot) spawnSync("chown", ["nobody:nogroup", P(f)]);
  const backup = async (over: Record<string, string> = {}) => {
    writeBackupEnv(over);
    if (asRoot) spawnSync("chown", ["nobody:nogroup", P("backup.env")]);
    pings.length = 0;
    return run(`"${BACKUP_SCRIPT}"`, { PAYLINK_ENV_FILE: P("app.env"), PAYLINK_BACKUP_ENV_FILE: P("backup.env"), PAYLINK_PG_BINDIR: pgBinDir! });
  };

  // ---------------------------------------------------------------- success path
  console.log("success path");
  const r1 = await backup();
  ok("backup exits 0", r1.code === 0, r1.out.slice(-1500));
  const localFiles = walk(P("local")).map((f) => path.relative(P("local"), f));
  const enc = localFiles.find((f) => /^paylink-prod-\d{8}T\d{6}Z\.dump\.gpg$/.test(f));
  ok("local encrypted dump present", !!enc, localFiles.join(", "));
  ok("local sha256 + manifest present", !!enc && localFiles.includes(`${enc}.sha256`) && localFiles.includes(enc.replace(".dump.gpg", ".manifest.txt")));
  ok("no plaintext .dump and no work dir left locally", !localFiles.some((f) => f.endsWith(".dump") || f.includes(".work-")), localFiles.join(", "));
  ok("last-success marker written", fs.existsSync(P("local", "last-success")) && fs.readFileSync(P("local", "last-success"), "utf8").includes(enc || "x"));
  ok("log never contains the DB password", !r1.out.includes(SECRET_PW) && !r1.out.includes(encodedPw));
  ok("pings: start then success, no /fail", pings.includes("/hc/start") && pings.includes("/hc") && !pings.includes("/hc/fail"), pings.join(","));

  const remoteFiles = walk(P("remote"));
  const remoteEnc = remoteFiles.find((f) => f.endsWith(".dump.gpg"));
  ok("off-server copy under prod/YYYY/MM/", !!remoteEnc && /\/prod\/\d{4}\/\d{2}\/paylink-prod-/.test(remoteEnc), remoteFiles.join(", "));
  ok("off-server sha256 + manifest uploaded", remoteFiles.length === 3, String(remoteFiles.length));
  if (enc && remoteEnc) {
    const sha = (f: string) => spawnSync("sha256sum", [f]).stdout.toString().split(" ")[0];
    ok("off-server copy byte-identical to local", sha(remoteEnc) === sha(P("local", enc)));
    const recorded = fs.readFileSync(P("local", `${enc}.sha256`), "utf8").split(" ")[0];
    ok("recorded sha256 matches file", recorded === sha(remoteEnc));
    const raw = fs.readFileSync(remoteEnc);
    ok("encrypted artifact does not contain plaintext data (canary absent)", !raw.includes(Buffer.from(CANARY)) && !raw.includes(Buffer.from("PGDMP")));
    const srvDecrypt = await run(`GNUPGHOME=server-gnupg gpg --batch --decrypt --output /dev/null "${remoteEnc}"`);
    ok("server keyring CANNOT decrypt (no private key on server)", srvDecrypt.code !== 0);
    const manifest = fs.readFileSync(P("local", enc.replace(".dump.gpg", ".manifest.txt")), "utf8");
    ok("manifest records PASS restore drill + hashes", /restore_drill=PASS/.test(manifest) && manifest.includes(`encrypted_sha256=${recorded}`) && /toc_tables=5/.test(manifest), manifest.slice(0, 600));
    ok("manifest has no password / connection string", !manifest.includes(SECRET_PW) && !manifest.includes("postgresql://"));

    // non-destructive restore drill of the OFF-SERVER copy with the offline key
    const drill = await run(`"${VERIFY_SCRIPT}" --min-tables 5 --require-rows "companies users workers payroll_items" --report drill.txt "${remoteEnc}"`,
      { GNUPGHOME: P("admin-gnupg"), PAYLINK_PG_BINDIR: pgBinDir! });
    ok("restore drill of off-server copy (admin key) passes", drill.code === 0, drill.out.slice(-800));
    const report = fs.existsSync(P("drill.txt")) ? fs.readFileSync(P("drill.txt"), "utf8") : "";
    for (const [t, n] of [["companies", 3], ["users", 25], ["workers", 40], ["payroll_items", 500], ["empty_audit", 0]] as const) {
      ok(`restored row count public.${t} = ${n}`, new RegExp(`^public\\.${t} ${n}$`, "m").test(report), report);
    }
  }

  // ---------------------------------------------------------------- failure paths
  const snapshot = () => ({
    local: walk(P("local")).filter((f) => !f.endsWith(".backup.lock")).sort().join("|"),
    remote: walk(P("remote")).sort().join("|"),
    last: fs.existsSync(P("local", "last-success")) ? fs.readFileSync(P("local", "last-success"), "utf8") : "",
  });
  const noPlaintext = () => !walk(P("local")).some((f) => f.endsWith(".dump") || f.includes(".work-") || f.endsWith("pgpass"));

  console.log("\nfailure: wrong DB password");
  {
    const before = snapshot();
    fs.writeFileSync(P("app.env"), fs.readFileSync(P("app.env"), "utf8").replace(encodedPw, "wrong-password"));
    const r = await backup();
    fs.writeFileSync(P("app.env"), fs.readFileSync(P("app.env"), "utf8").replace("wrong-password", encodedPw));
    ok("exits non-zero", r.code !== 0);
    ok("names the failing stage", /stage 'pg_dump'/.test(r.out), r.out.slice(-600));
    ok("pings /fail", pings.includes("/hc/fail"), pings.join(","));
    ok("no new local/remote files, last-success unchanged", JSON.stringify(snapshot()) === JSON.stringify(before));
    ok("no plaintext / pgpass / work dir left", noPlaintext());
    ok("log never contains the real password", !r.out.includes(SECRET_PW));
  }

  console.log("\nfailure: encryption recipient not configured");
  {
    const before = snapshot();
    const r = await backup({ PAYLINK_BACKUP_GPG_RECIPIENT: "" });
    ok("refuses to run without an encryption key", r.code !== 0 && /GPG_RECIPIENT is not set/.test(r.out), r.out.slice(-400));
    ok("nothing written", JSON.stringify(snapshot()) === JSON.stringify(before));
  }

  console.log("\nfailure: unknown gpg recipient");
  {
    const r = await backup({ PAYLINK_BACKUP_GPG_RECIPIENT: "0".repeat(40) });
    ok("fails preflight on missing key", r.code !== 0 && /recipient key not found/.test(r.out), r.out.slice(-400));
  }

  console.log("\nfailure: off-server remote unreachable");
  {
    const before = snapshot();
    const r = await backup({ PAYLINK_BACKUP_RCLONE_REMOTE: "nosuchremote:bucket/prod" });
    ok("exits non-zero at upload", r.code !== 0 && /stage 'upload'/.test(r.out), r.out.slice(-600));
    ok("pings /fail", pings.includes("/hc/fail"));
    ok("last-success NOT advanced", snapshot().last === before.last);
    ok("encrypted local copy kept (useful), still no plaintext", noPlaintext() && walk(P("local")).filter((f) => f.endsWith(".dump.gpg")).length === 2);
  }

  console.log("\nfailure: table-count floor");
  {
    const r = await backup({ PAYLINK_BACKUP_MIN_TABLES: "500" });
    ok("dump below PAYLINK_BACKUP_MIN_TABLES fails", r.code !== 0 && /stage 'toc-check'/.test(r.out), r.out.slice(-400));
  }

  console.log("\nfailure: required table empty");
  {
    const r = await backup({ PAYLINK_BACKUP_REQUIRE_ROWS: "companies empty_audit" });
    ok("restore drill fails when a required table is empty", r.code !== 0 && /stage 'restore-verify'/.test(r.out) && /empty after restore: public.empty_audit/.test(r.out), r.out.slice(-600));
    ok("no plaintext left after drill failure", noPlaintext());
  }

  console.log("\nrestore drill rejects a corrupt dump");
  {
    await must(`GNUPGHOME=admin-gnupg gpg --batch --quiet --decrypt --output good.dump "${remoteEnc}" && head -c $(( $(stat -c %s good.dump) * 2 / 3 )) good.dump > truncated.dump`);
    const r = await run(`"${VERIFY_SCRIPT}" --min-tables 5 truncated.dump`, { PAYLINK_PG_BINDIR: pgBinDir! });
    ok("truncated dump fails the drill", r.code !== 0, r.out.slice(-400));
    const g = await run(`"${VERIFY_SCRIPT}" --min-tables 5 good.dump >/dev/null`, { PAYLINK_PG_BINDIR: pgBinDir! });
    ok("intact plaintext dump passes the drill", g.code === 0, g.out.slice(-400));
  }

  console.log("\nretention");
  {
    await must(`cd local && for f in paylink-prod-20200101T000000Z.dump.gpg paylink-prod-20200101T000000Z.dump.gpg.sha256 paylink-prod-20200101T000000Z.manifest.txt predeploy-v2.2.16-20200101T000000Z.sql.gz unrelated.txt; do echo x > $f; touch -d '30 days ago' $f; done`);
    await must(`mkdir -p remote/prod/2020/01 && cd remote/prod/2020/01 && for f in paylink-prod-20200101T000000Z.dump.gpg other-object.bin; do echo x > $f; touch -d '120 days ago' $f; done`);
    const r = await backup();
    ok("backup with old files succeeds", r.code === 0, r.out.slice(-600));
    const local = fs.readdirSync(P("local"));
    ok("old paylink-prod-* local files pruned", !local.some((f) => f.startsWith("paylink-prod-20200101")), local.join(", "));
    ok("pre-deploy dump + unrelated files untouched", local.includes("predeploy-v2.2.16-20200101T000000Z.sql.gz") && local.includes("unrelated.txt"));
    ok("remote NOT pruned when REMOTE_RETAIN_DAYS unset", fs.existsSync(P("remote/prod/2020/01/paylink-prod-20200101T000000Z.dump.gpg")));
    const r2 = await backup({ PAYLINK_BACKUP_REMOTE_RETAIN_DAYS: "3" });
    ok("remote retention < 7 days refused", r2.code !== 0 && /REMOTE_RETAIN_DAYS must be/.test(r2.out));
    const r3 = await backup({ PAYLINK_BACKUP_REMOTE_RETAIN_DAYS: "90" });
    ok("remote retention 90d run succeeds", r3.code === 0, r3.out.slice(-600));
    ok("old remote backup pruned", !fs.existsSync(P("remote/prod/2020/01/paylink-prod-20200101T000000Z.dump.gpg")));
    ok("non-backup remote object untouched", fs.existsSync(P("remote/prod/2020/01/other-object.bin")));
    ok("fresh remote backups retained", walk(P("remote")).filter((f) => f.endsWith(".dump.gpg")).length >= 3);
  }

  hc.close();
}

main()
  .catch((e) => { fail++; console.error(e); })
  .finally(() => {
    spawnSync("bash", ["-c", `${asRoot ? "runuser -u nobody -- " : ""}${pgBinDir}/pg_ctl -D "${P("src/data")}" -m immediate stop >/dev/null 2>&1`]);
    fs.rmSync(ROOT, { recursive: true, force: true });
    console.log(`\n${pass} passed, ${fail} failed`);
    process.exit(fail > 0 ? 1 : 0);
  });
