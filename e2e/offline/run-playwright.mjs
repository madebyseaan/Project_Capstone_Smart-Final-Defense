/**
 * run-playwright.mjs — seed the isolated DB, then run the Playwright offline suite.
 * Playwright's webServer array starts/stops the stubs + rig backend + frontend.
 *
 * Requires the same env as run-rig.mjs (DATABASE_URL *_test, loopback URLs, SMART_TEST_*).
 */
import { spawnSync } from "node:child_process";
import path from "node:path";
import process from "node:process";
import { checkRigEnv } from "./guards.mjs";

const ROOT = path.resolve(import.meta.dirname, "..", "..");
const SERVER_DIR = path.join(ROOT, "server");

const env = {
  ...process.env,
  NODE_ENV: "development",
  EP_BREAKER_COOLDOWN_MS: process.env.EP_BREAKER_COOLDOWN_MS ?? "1000",
  SYNC_INTERVAL_MS: process.env.SYNC_INTERVAL_MS ?? "600000",
};

const guard = checkRigEnv(env);
console.log("[pw-rig] env:", JSON.stringify(guard.info));
if (!guard.ok) {
  for (const err of guard.errors) console.error(`[pw-rig] REFUSED: ${err}`);
  process.exit(1);
}

function run(cmd, args, cwd) {
  console.log(`[pw-rig] $ ${cmd} ${args.join(" ")}`);
  const result = spawnSync(cmd, args, { cwd, env, stdio: "inherit", shell: process.platform === "win32" });
  if (result.status !== 0) {
    console.error(`[pw-rig] command failed (${result.status}): ${cmd} ${args.join(" ")}`);
    process.exit(result.status ?? 1);
  }
}

run("npx", ["prisma", "db", "push", "--accept-data-loss"], SERVER_DIR);
run("npx", ["ts-node", "--transpile-only", "scripts/wipe.ts"], SERVER_DIR);
run("npx", ["ts-node", "--transpile-only", "scripts/seed-test-base.ts"], SERVER_DIR);
run("npx", ["ts-node", "--transpile-only", "scripts/seed-offline-fixtures.ts"], SERVER_DIR);
run("npx", ["playwright", "test", "-c", "e2e/offline/playwright.offline.config.ts"], ROOT);
