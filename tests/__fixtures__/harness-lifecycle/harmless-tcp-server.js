/**
 * Harmless, dependency-free fixture process for
 * tests/server-harness-lifecycle.test.ts. Never touches a database, never
 * makes a network call beyond its own loopback listener. Controlled
 * entirely by environment variables so one file covers every lifecycle
 * scenario the regression suite needs:
 *
 *   PORT              required — 127.0.0.1 port to listen on.
 *   NEVER_LISTEN=1    idle forever without ever binding PORT (simulates a
 *                     process that never becomes ready).
 *   EXIT_IMMEDIATELY=1  exit(1) right after start, before listening
 *                     (simulates a spawn that dies early).
 *   SPAWN_GRANDCHILD_PORT=<port>  after listening on PORT, also spawn a
 *                     second, non-detached instance of this same file
 *                     listening on the given port — inherits this
 *                     process's process group, the same way tsx's cli.mjs
 *                     spawns its own loader child.
 */
import net from "node:net";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

if (process.env.EXIT_IMMEDIATELY === "1") {
  process.exit(1);
}

if (process.env.NEVER_LISTEN === "1") {
  setInterval(() => {}, 1000);
} else {
  const port = Number(process.env.PORT);
  const srv = net.createServer((sock) => sock.end());
  srv.listen(port, "127.0.0.1", () => {
    console.log(`READY pid=${process.pid} port=${port}`);
  });

  const grandchildPort = process.env.SPAWN_GRANDCHILD_PORT;
  if (grandchildPort) {
    const self = fileURLToPath(import.meta.url);
    spawn(process.execPath, [self], {
      env: { ...process.env, PORT: grandchildPort, SPAWN_GRANDCHILD_PORT: "" },
      stdio: ["ignore", "inherit", "inherit"],
    });
  }

  setInterval(() => {}, 1000);
}
