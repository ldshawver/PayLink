/**
 * Regression coverage for the cross-tenant test harness's process
 * lifecycle (scripts/cross-tenant-negative-tests/server-harness.ts).
 *
 * Root cause this guards against: the harness used to spawn its test
 * server via `npx tsx ...` and track only the npx wrapper's pid. npx does
 * not reliably forward SIGTERM to the process it resolves and execs, so
 * `child.kill("SIGTERM")` on that tracked pid killed npx but left the
 * actual tsx/node process — and anything it spawned — running as an
 * orphan, still holding its port. See docs/saas-readiness/ (this branch's
 * PR body) for the full write-up.
 *
 * This file exercises spawnManagedProcess() directly against a harmless,
 * dependency-free fixture server (tests/__fixtures__/harness-lifecycle/
 * harmless-tcp-server.js) — no database, no network beyond loopback, no
 * external service, so it needs zero configuration and is safe to run on
 * every PR. It never spawns server/index.ts itself; the existing DB-suite
 * test (tests/cross-tenant-worker-routes-db.test.ts) already covers
 * startTestServer end-to-end against the real app.
 *
 * Run: npx tsx tests/server-harness-lifecycle.test.ts
 */
import net from "node:net";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { spawnManagedProcess, resolveTsxCliPath, type ManagedProcess } from "../scripts/cross-tenant-negative-tests/server-harness";

let pass = 0;
let fail = 0;
const failures: string[] = [];
async function check(name: string, fn: () => Promise<void> | void): Promise<void> {
  try {
    await fn();
    pass++;
    console.log(`  ✓ ${name}`);
  } catch (e) {
    fail++;
    const detail = e instanceof Error ? e.message : String(e);
    failures.push(`${name}: ${detail}`);
    console.error(`  ✗ ${name} — ${detail}`);
  }
}

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

const FIXTURES_DIR = path.dirname(fileURLToPath(import.meta.url)) + "/__fixtures__/harness-lifecycle";
const FIXTURE_SERVER = path.join(FIXTURES_DIR, "harmless-tcp-server.js");
const SIGNAL_DRIVER = path.join(FIXTURES_DIR, "signal-forwarding-driver.ts");

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

/** true = a process with this pid exists (POSIX `kill -0` idiom), false = it does not (ESRCH). */
function pidExists(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code !== "ESRCH";
  }
}

function isPortListening(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const sock = net.createConnection({ host: "127.0.0.1", port, timeout: 500 });
    sock.once("connect", () => {
      sock.destroy();
      resolve(true);
    });
    sock.once("error", () => resolve(false));
    sock.once("timeout", () => {
      sock.destroy();
      resolve(false);
    });
  });
}

async function waitFor(fn: () => Promise<boolean> | boolean, timeoutMs: number, intervalMs = 50): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await fn()) return true;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  return false;
}

async function startFixture(
  port: number,
  extraEnv: Record<string, string> = {},
): Promise<{ child: ReturnType<typeof spawnManagedProcess>["child"]; managed: ManagedProcess }> {
  const { child, managed } = spawnManagedProcess(process.execPath, [FIXTURE_SERVER], {
    cwd: process.cwd(),
    env: { ...process.env, PORT: String(port), ...extraEnv },
  });
  return { child, managed };
}

async function main() {
  // 1 & 2. Harness starts the disposable test server; readiness succeeds.
  await check("starts the disposable fixture server and it becomes ready", async () => {
    const port = await getFreePort();
    const { managed } = await startFixture(port);
    try {
      const ready = await waitFor(() => isPortListening(port), 5000);
      assert(ready, "fixture never started listening");
    } finally {
      await managed.stop();
    }
  });

  // 3, 4 & 5. stop() terminates the server; the exact pid is gone; the port is freed.
  await check("stop() terminates the server, its pid, and its port", async () => {
    const port = await getFreePort();
    const { managed } = await startFixture(port);
    assert(await waitFor(() => isPortListening(port), 5000), "fixture never started listening");
    assert(pidExists(managed.pid), "pid should exist while server is running");

    await managed.stop();

    assert(!pidExists(managed.pid), `pid ${managed.pid} still exists after stop()`);
    assert(!(await isPortListening(port)), `port ${port} is still listening after stop()`);
  });

  // 6. No tracked descendant remains — a fixture that spawns its own grandchild.
  await check("stop() also terminates a descendant the tracked process spawned", async () => {
    const port = await getFreePort();
    const grandchildPort = await getFreePort();
    const { child, managed } = await startFixture(port, { SPAWN_GRANDCHILD_PORT: String(grandchildPort) });

    let grandchildPid: number | null = null;
    child.stdout?.on("data", (chunk: Buffer) => {
      // A single 'data' chunk can contain more than one line (e.g. both the
      // parent's and the grandchild's READY lines flushed together), so
      // this must scan every match in the chunk, not just the first.
      for (const m of chunk.toString().matchAll(/READY pid=(\d+) port=(\d+)/g)) {
        if (Number(m[2]) === grandchildPort) grandchildPid = Number(m[1]);
      }
    });

    assert(await waitFor(() => isPortListening(port), 5000), "parent fixture never started listening");
    assert(await waitFor(() => isPortListening(grandchildPort), 5000), "grandchild fixture never started listening");
    assert(await waitFor(() => grandchildPid !== null, 2000), "never observed grandchild pid on stdout");

    await managed.stop();

    // stop() resolves once the tracked (parent) process reports its own
    // exit; the kernel delivers SIGTERM to every process in the group at
    // essentially the same instant, but each process's own exit handling
    // can land a few milliseconds apart — so the grandchild's exit is
    // polled with a short bound rather than asserted synchronously.
    assert(!pidExists(managed.pid), "tracked (parent) pid still exists after stop()");
    assert(await waitFor(() => !pidExists(grandchildPid!), 2000), `grandchild pid ${grandchildPid} still exists after stop() — process group was not fully terminated`);
    assert(await waitFor(async () => !(await isPortListening(grandchildPort)), 2000), "grandchild's port is still listening after stop()");
  });

  // 7. Calling stop() twice (including concurrently) is safe.
  await check("stop() is idempotent", async () => {
    const port = await getFreePort();
    const { managed } = await startFixture(port);
    assert(await waitFor(() => isPortListening(port), 5000), "fixture never started listening");

    await Promise.all([managed.stop(), managed.stop()]);
    await managed.stop(); // a third, fully-sequential call after settlement

    assert(!pidExists(managed.pid), "pid still exists after repeated stop()");
  });

  // 8. Cleanup occurs after a successful run of caller code (finally-block pattern),
  // exactly like tests/cross-tenant-worker-routes-db.test.ts does with startTestServer.
  await check("cleanup runs after the caller's code completes successfully", async () => {
    const port = await getFreePort();
    let managed: ManagedProcess | null = null;
    try {
      const started = await startFixture(port);
      managed = started.managed;
      assert(await waitFor(() => isPortListening(port), 5000), "fixture never started listening");
      // ... caller's normal-path work would go here ...
    } finally {
      if (managed) await managed.stop();
    }
    assert(managed !== null && !pidExists(managed.pid), "pid still exists after cleanup following successful completion");
  });

  // 9. Cleanup occurs after a deliberately failed assertion inside the caller's try block.
  await check("cleanup still runs when the caller's code throws", async () => {
    const port = await getFreePort();
    let managed: ManagedProcess | null = null;
    let threw = false;
    try {
      const started = await startFixture(port);
      managed = started.managed;
      assert(await waitFor(() => isPortListening(port), 5000), "fixture never started listening");
      throw new Error("deliberate failure inside caller's try block");
    } catch (e) {
      threw = e instanceof Error && e.message.includes("deliberate failure");
    } finally {
      if (managed) await managed.stop();
    }
    assert(threw, "expected the deliberate failure to propagate to the catch block");
    assert(managed !== null && !pidExists(managed.pid), "pid still exists after cleanup following a thrown error");
  });

  // 10. Cleanup occurs after a readiness timeout, mirroring startTestServer's catch path.
  await check("cleanup runs when the caller gives up waiting for readiness", async () => {
    const port = await getFreePort();
    const { managed } = await startFixture(port, { NEVER_LISTEN: "1" });
    const becameReady = await waitFor(() => isPortListening(port), 1000);
    assert(!becameReady, "fixture was not supposed to become ready");

    // Mirrors startTestServer's catch block: readiness failed, tear down
    // the full tree before propagating.
    await managed.stop();

    assert(!pidExists(managed.pid), "pid still exists after cleanup following a readiness timeout");
  });

  // 11. Cleanup occurs when the spawned server exits early on its own.
  await check("stop() resolves promptly when the process already exited on its own", async () => {
    const port = await getFreePort();
    const { child, managed } = await startFixture(port, { EXIT_IMMEDIATELY: "1" });
    await new Promise<void>((resolve) => child.once("exit", () => resolve()));
    assert(!pidExists(managed.pid), "pid should already be gone");

    const start = Date.now();
    await managed.stop();
    const elapsedMs = Date.now() - start;
    assert(elapsedMs < 2000, `stop() took ${elapsedMs}ms for an already-exited process — should be near-instant, not wait out the grace period`);
  });

  // 12a/12b. Cleanup occurs when the parent receives SIGINT / SIGTERM, tested in a subprocess.
  for (const signal of ["SIGTERM", "SIGINT"] as const) {
    await check(`a ${signal} sent to the managing parent tears down its managed child`, async () => {
      const port = await getFreePort();
      const driver = spawn(process.execPath, [resolveTsxCliPath(), SIGNAL_DRIVER], {
        cwd: process.cwd(),
        env: { ...process.env, FIXTURE_PORT: String(port) },
        stdio: ["ignore", "pipe", "pipe"],
      });

      let fixturePid: number | null = null;
      driver.stdout?.on("data", (chunk: Buffer) => {
        const m = chunk.toString().match(/DRIVER_READY (\d+)/);
        if (m) fixturePid = Number(m[1]);
      });

      try {
        assert(await waitFor(() => isPortListening(port), 8000), "driver's fixture never became ready");
        assert(await waitFor(() => fixturePid !== null, 2000), "never observed the driver-managed fixture pid");

        driver.kill(signal);

        const driverExited = await waitFor(() => driver.exitCode !== null || driver.signalCode !== null, 5000);
        assert(driverExited, `driver did not exit after ${signal}`);
        assert(await waitFor(() => !pidExists(fixturePid!), 3000), `fixture pid ${fixturePid} still exists after the driver received ${signal}`);
        assert(await waitFor(async () => !(await isPortListening(port)), 3000), `fixture port ${port} is still listening after the driver received ${signal}`);
      } finally {
        if (driver.exitCode === null && driver.signalCode === null) driver.kill("SIGKILL");
        if (fixturePid !== null && pidExists(fixturePid)) {
          try {
            process.kill(fixturePid, "SIGKILL");
          } catch {
            // already gone
          }
        }
      }
    });
  }

  // 13. Concurrent harness instances on different disposable ports do not kill each other.
  await check("stopping one managed instance does not affect a concurrent, unrelated instance", async () => {
    const portA = await getFreePort();
    const portB = await getFreePort();
    const a = await startFixture(portA);
    const b = await startFixture(portB);
    try {
      assert(await waitFor(() => isPortListening(portA), 5000), "instance A never started listening");
      assert(await waitFor(() => isPortListening(portB), 5000), "instance B never started listening");

      await a.managed.stop();

      assert(!pidExists(a.managed.pid), "instance A pid still exists after stopping A");
      assert(pidExists(b.managed.pid), "instance B was killed by stopping instance A");
      assert(await isPortListening(portB), "instance B's port was closed by stopping instance A");
    } finally {
      await b.managed.stop();
    }
  });

  // 14. The harness never kills an unrelated sentinel process it did not spawn/track.
  await check("never signals an unrelated process outside its own tracked group", async () => {
    const sentinelPort = await getFreePort();
    const sentinel = spawn(process.execPath, [FIXTURE_SERVER], {
      cwd: process.cwd(),
      env: { ...process.env, PORT: String(sentinelPort) },
      stdio: ["ignore", "pipe", "pipe"],
    });
    try {
      assert(sentinel.pid != null, "sentinel failed to spawn");
      assert(await waitFor(() => isPortListening(sentinelPort), 5000), "sentinel never started listening");

      const managedPort = await getFreePort();
      const { managed } = await startFixture(managedPort);
      assert(await waitFor(() => isPortListening(managedPort), 5000), "managed fixture never started listening");
      await managed.stop();

      assert(pidExists(sentinel.pid!), "unrelated sentinel process was killed by an unrelated managed instance's stop()");
      assert(await isPortListening(sentinelPort), "unrelated sentinel's port was closed by an unrelated managed instance's stop()");
    } finally {
      if (sentinel.pid != null && pidExists(sentinel.pid)) {
        process.kill(sentinel.pid, "SIGKILL");
      }
    }
  });

  console.log(`\n=== ${pass} passed, ${fail} failed ===`);
  if (fail > 0) {
    console.error(`\nFailures:\n${failures.map((f) => `  - ${f}`).join("\n")}`);
  }
  process.exitCode = fail === 0 ? 0 : 1;
}

main().catch((e) => {
  console.error("Test run failed:", e instanceof Error ? e.stack ?? e.message : e);
  process.exitCode = 1;
});
