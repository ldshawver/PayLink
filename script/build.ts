import { build as esbuild } from "esbuild";
import { build as viteBuild } from "vite";
import { rm, readFile, copyFile, mkdir, symlink } from "fs/promises";
import { existsSync } from "fs";
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

  // Pre-seed node_modules/.vite-temp/node_modules as a symlink so that
  // Vite's ESM config loader can resolve bare-specifier imports (e.g.
  // @vitejs/plugin-react) from inside the temp directory on Linux servers
  // where the standard upward traversal gets blocked at the node_modules
  // boundary.
  const viteTempDir = resolve(projectRoot, "node_modules", ".vite-temp");
  const viteTempNM = resolve(viteTempDir, "node_modules");
  const realNM = resolve(projectRoot, "node_modules");
  if (!existsSync(viteTempNM)) {
    await mkdir(viteTempDir, { recursive: true });
    await symlink(realNM, viteTempNM).catch(() => {});
  }

  // Also ensure NODE_PATH points at the project's node_modules so any
  // other ESM subprocesses spawned during build can find packages.
  process.env.NODE_PATH = realNM;

  console.log("building client...");
  await viteBuild();

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
