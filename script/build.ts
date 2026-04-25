import { build as esbuild } from "esbuild";
import { rm, readFile, copyFile } from "fs/promises";
import { spawnSync } from "child_process";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(__dirname, "..");

// server deps to bundle to reduce openat(2) syscalls
// which helps cold start times
const allowlist = [
  "@google/generative-ai",
  "axios",
  "connect-pg-simple",
  "cors",
  "date-fns",
  "drizzle-orm",
  "drizzle-zod",
  "express",
  "express-rate-limit",
  "express-session",
  "jsonwebtoken",
  "memorystore",
  "multer",
  "nanoid",
  "nodemailer",
  "openai",
  "passport",
  "passport-local",
  "pg",
  "stripe",
  "uuid",
  "ws",
  "xlsx",
  "zod",
  "zod-validation-error",
];

async function buildAll() {
  await rm("dist", { recursive: true, force: true });

  // Run the Vite client build as a separate child process so it starts
  // outside tsx's ESM loader hooks. This lets Node.js's native ESM resolver
  // find bare-specifier packages (like @vitejs/plugin-react) from the
  // project root rather than from inside Vite's temp directory.
  console.log("building client...");
  const viteBin = resolve(projectRoot, "node_modules", ".bin", "vite");
  const viteResult = spawnSync(viteBin, ["build"], {
    stdio: "inherit",
    cwd: projectRoot,
    env: { ...process.env },
  });
  if (viteResult.status !== 0) {
    process.exit(viteResult.status ?? 1);
  }

  console.log("building server...");
  const pkg = JSON.parse(await readFile("package.json", "utf-8"));
  const allDeps = [
    ...Object.keys(pkg.dependencies || {}),
    ...Object.keys(pkg.devDependencies || {}),
  ];
  const externals = allDeps.filter((dep) => !allowlist.includes(dep));

  await esbuild({
    entryPoints: ["server/index.ts"],
    platform: "node",
    bundle: true,
    format: "cjs",
    outfile: "dist/index.cjs",
    define: {
      "process.env.NODE_ENV": '"production"',
    },
    minify: true,
    external: externals,
    logLevel: "info",
  });

  await copyFile("node_modules/connect-pg-simple/table.sql", "dist/table.sql");
}

buildAll().catch((err) => {
  console.error(err);
  process.exit(1);
});
