// Shared by scripts/check-headers.mjs and scripts/smoke.mjs: use a web app that is already
// running (--url http://127.0.0.1:3000) or boot the BUILT app (apps/web/.next) on a free
// loopback port, in production mode, against DATABASE_URL. Dependency-free on purpose.
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

/** `--name value` and `--flag` arguments. */
export function parseArgs(argv = process.argv.slice(2)) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) continue;
    const next = argv[i + 1];
    if (next === undefined || next.startsWith("--")) out[a.slice(2)] = true;
    else out[a.slice(2)] = argv[++i];
  }
  return out;
}

function assertLoopback(url) {
  const host = new URL(url).hostname;
  if (!["127.0.0.1", "localhost", "[::1]"].includes(host)) {
    throw new Error(`Refusing to run against ${host}: these checks are loopback-only.`);
  }
}

function freePort() {
  return new Promise((ok, fail) => {
    const srv = createServer();
    srv.once("error", fail);
    srv.listen(0, "127.0.0.1", () => {
      const { port } = srv.address();
      srv.close(() => ok(port));
    });
  });
}

async function waitForHealth(base, child, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let last = "no answer";
  while (Date.now() < deadline) {
    if (child && child.exitCode !== null) throw new Error(`The web app exited with code ${child.exitCode} before it became healthy.`);
    try {
      const res = await fetch(`${base}/api/health`, { signal: AbortSignal.timeout(3000) });
      if (res.status === 200) return;
      last = `HTTP ${res.status}`;
    } catch (e) {
      last = e.cause?.code ?? e.name;
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error(`The web app did not become healthy within ${Math.round(timeoutMs / 1000)} s (${last}).`);
}

/**
 * Returns { base, production, stop() }. With `url` nothing is started. Otherwise the built app
 * is started with a throwaway session secret and a temporary upload folder; only variable
 * names are ever printed.
 */
export async function withWebApp({ url } = {}) {
  if (url) {
    const base = String(url).replace(/\/+$/, "");
    assertLoopback(base);
    await waitForHealth(base, null, 30_000);
    return { base, production: null, stop: async () => {} };
  }
  const webDir = join(repoRoot, "apps/web");
  if (!existsSync(join(webDir, ".next", "BUILD_ID"))) {
    throw new Error("apps/web is not built. Run: pnpm --filter @ed/web build   (or pass --url of a running app)");
  }
  if (!process.env.DATABASE_URL) throw new Error("Missing environment variable: DATABASE_URL");
  const port = await freePort();
  const base = `http://127.0.0.1:${port}`;
  const storageDir = mkdtempSync(join(tmpdir(), "ed-smoke-"));
  const child = spawn(process.execPath, [join(webDir, "node_modules/next/dist/bin/next"), "start", "--port", String(port), "--hostname", "127.0.0.1"], {
    cwd: webDir,
    stdio: ["ignore", "ignore", "inherit"],
    env: {
      ...process.env,
      NODE_ENV: "production",
      APP_URL: base,
      PUBLIC_URL: process.env.PUBLIC_URL || "http://127.0.0.1:3001",
      MEDIA_URL: process.env.MEDIA_URL || `http://localhost:${port}`,
      SESSION_SECRET: process.env.SESSION_SECRET || randomBytes(32).toString("hex"),
      EMAIL_PROVIDER: "dev",
      STORAGE_DIR: process.env.STORAGE_DIR || storageDir,
      AUTH_TIMING_FLOOR_MS: "0",
      APP_VERSION: process.env.APP_VERSION || "ci",
    },
  });
  const stop = async () => {
    if (child.exitCode === null) {
      child.kill("SIGTERM");
      await Promise.race([new Promise((r) => child.once("exit", r)), new Promise((r) => setTimeout(r, 5000))]);
      if (child.exitCode === null) child.kill("SIGKILL");
    }
    rmSync(storageDir, { recursive: true, force: true });
  };
  try {
    await waitForHealth(base, child, 90_000);
  } catch (e) {
    await stop();
    throw e;
  }
  return { base, production: true, stop };
}

/** Collects failures; prints one line per check. */
export function reporter(name) {
  const failures = [];
  return {
    ok(label) {
      console.info(`  ok    ${label}`);
    },
    check(condition, label, detail = "") {
      if (condition) console.info(`  ok    ${label}`);
      else {
        failures.push(label);
        console.error(`  FAIL  ${label}${detail ? ` — ${detail}` : ""}`);
      }
      return Boolean(condition);
    },
    finish() {
      if (failures.length > 0) {
        console.error(`\n${name}: ${failures.length} check(s) failed.`);
        return 1;
      }
      console.info(`\n${name}: all checks passed.`);
      return 0;
    },
  };
}
