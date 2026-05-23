import { build as esbuild } from "esbuild";
import { build as viteBuild } from "vite";
import { cp, rm, readFile, copyFile } from "fs/promises";
import { execSync } from "child_process";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import viteConfig from "../vite.config";

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

async function clearDist() {
  try {
    await rm("dist", { recursive: true, force: true });
  } catch (e: any) {
    if (e.code === "EACCES") {
      // dist/ was created by a root PM2 process; escalate to sudo
      console.warn("Warning: dist/ is root-owned — attempting sudo cleanup");
      try {
        execSync("sudo rm -rf dist/", { stdio: "inherit" });
      } catch {
        // sudo unavailable; fix ownership then retry
        execSync(`sudo chown -R "$(id -un):$(id -un)" dist/ && rm -rf dist/`, { stdio: "inherit", shell: true });
      }
    } else {
      throw e;
    }
  }
}

async function buildAll() {
  await clearDist();

  // Build the client using the already-imported vite config object.
  // Passing configFile:false tells Vite not to re-load vite.config.ts from
  // disk, which avoids the .vite-temp ESM temp-file mechanism that fails to
  // resolve bare-specifier packages on Linux servers.
  // This mirrors what server/vite.ts does for the dev server.
  console.log("building client...");
  await viteBuild({
    ...viteConfig,
    configFile: false,
  });

  console.log("copying marketing site...");
  await copyFile(
    resolve(projectRoot, "dist", "public", "index.html"),
    resolve(projectRoot, "dist", "public", "app.html"),
  );
  await cp(
    resolve(projectRoot, "public-site", "public"),
    resolve(projectRoot, "dist", "public"),
    { recursive: true },
  );

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
