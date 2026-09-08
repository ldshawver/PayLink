/**
 * Stands in for "a caller of startTestServer" for
 * tests/server-harness-lifecycle.test.ts's SIGINT/SIGTERM propagation
 * cases. Spawns the harmless fixture server as its own managed child via
 * spawnManagedProcess (the same primitive startTestServer uses), prints
 * `DRIVER_READY <fixturePid>` once it is listening, then idles.
 *
 * Deliberately never calls stop() itself — the only thing that should tear
 * down the fixture here is spawnManagedProcess's own SIGINT/SIGTERM
 * forwarding. The outer test spawns this file as a subprocess, signals it,
 * and verifies the fixture pid and port are gone once this process exits.
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnManagedProcess } from "../../../scripts/cross-tenant-negative-tests/server-harness";

const port = process.env.FIXTURE_PORT;
if (!port) {
  console.error("FIXTURE_PORT is required");
  process.exit(2);
}

const fixturePath = path.join(path.dirname(fileURLToPath(import.meta.url)), "harmless-tcp-server.js");

const { child, managed } = spawnManagedProcess(process.execPath, [fixturePath], {
  cwd: process.cwd(),
  env: { ...process.env, PORT: port },
});

child.stdout?.on("data", (chunk: Buffer) => {
  if (chunk.toString().startsWith("READY")) {
    console.log(`DRIVER_READY ${managed.pid}`);
  }
});

setInterval(() => {}, 1000);
