/**
 * run-rig.mjs — orchestrate the offline rig integration suite (T2).
 *
 * Order: guards → db push → wipe → seed base → seed fixtures → EP stub →
 *        rig backend (5004) → wait health → vitest → teardown.
 *
 * Requires (process env, never server/.env):
 *   DATABASE_URL    *_test database
 *   ENROLLPRO_URL   loopback EP stub
 *   ATLAS_URL       loopback (unused by EP-focused tests but required by guards)
 *   SMART_TEST_*    credentials (for the fixtures + login tests)
 */
import { spawn, spawnSync } from "node:child_process";
import path from "node:path";
import process from "node:process";
import { checkRigEnv } from "./guards.mjs";

const ROOT = path.resolve(import.meta.dirname, "..", "..");
const SERVER_DIR = path.join(ROOT, "server");
const EP_STUB_PORT = Number(process.env.EP_STUB_PORT ?? 5999);
const RIG_PORT = Number(process.env.RIG_PORT ?? 5004);

const env = {
  ...process.env,
  PORT: String(RIG_PORT),
  NODE_ENV: "development",
  STUB_PORT: String(EP_STUB_PORT),
  SYNC_INTERVAL_MS: process.env.SYNC_INTERVAL_MS ?? "600000",
  SYNC_INITIAL_DELAY_MS: process.env.SYNC_INITIAL_DELAY_MS ?? "1500",
  EP_BREAKER_COOLDOWN_MS: process.env.EP_BREAKER_COOLDOWN_MS ?? "1000",
};

function run(cmd, args, cwd = ROOT, extraEnv = env) {
  console.log(`[rig] $ ${cmd} ${args.join(" ")}`);
  const result = spawnSync(cmd, args, { cwd, env: extraEnv, stdio: "inherit", shell: process.platform === "win32" });
  if (result.status !== 0) {
    console.error(`[rig] command failed (${result.status}): ${cmd} ${args.join(" ")}`);
    process.exit(result.status ?? 1);
  }
}

function killTree(child) {
  if (!child || child.killed) return;
  if (process.platform === "win32") {
    spawnSync("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore" });
  } else {
    child.kill("SIGTERM");
  }
}

async function waitForHealth(url, timeoutMs = 60000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(2000) });
      if (res.ok) return true;
    } catch {
      /* retry */
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  return false;
}

const guard = checkRigEnv(env);
console.log("[rig] env:", JSON.stringify(guard.info));
if (!guard.ok) {
  for (const err of guard.errors) console.error(`[rig] REFUSED: ${err}`);
  process.exit(1);
}

run("npx", ["prisma", "db", "push", "--accept-data-loss"], SERVER_DIR);
run("npx", ["ts-node", "--transpile-only", "scripts/wipe.ts"], SERVER_DIR);
run("npx", ["ts-node", "--transpile-only", "scripts/seed-test-base.ts"], SERVER_DIR);
run("npx", ["ts-node", "--transpile-only", "scripts/seed-offline-fixtures.ts"], SERVER_DIR);

const stub = spawn(process.execPath, [path.join(ROOT, "e2e", "offline", "enrollpro-stub.mjs")], {
  env,
  stdio: "inherit",
});

const server = spawn(process.platform === "win32" ? "npm.cmd" : "npm", ["run", "dev"], {
  cwd: SERVER_DIR,
  env,
  stdio: "inherit",
  shell: process.platform === "win32",
});

let exitCode = 1;
try {
  const healthy = await waitForHealth(`http://127.0.0.1:${RIG_PORT}/api/health`);
  if (!healthy) {
    console.error("[rig] rig backend never became healthy — aborting");
  } else {
    const result = spawnSync(
      process.platform === "win32" ? "npx.cmd" : "npx",
      ["vitest", "run", "src/__tests__/rig-offline.test.ts"],
      {
        cwd: SERVER_DIR,
        env: { ...env, SMART_OFFLINE_RIG: "1", SMART_RIG_BASE: `http://127.0.0.1:${RIG_PORT}/api`, EP_STUB_CONTROL: `http://127.0.0.1:${EP_STUB_PORT}` },
        stdio: "inherit",
        shell: process.platform === "win32",
      },
    );
    exitCode = result.status ?? 1;
  }
} finally {
  killTree(server);
  killTree(stub);
}

console.log(`[rig] done (exit ${exitCode})`);
process.exit(exitCode);
