import { defineConfig } from "@playwright/test";

/**
 * E2E specs live in ./e2e. The dev servers (backend :5003, frontend :5173) are
 * expected to be running (`npm run dev`).
 *
 * Accounts come from env (SMART_TEST_*) or the gitignored
 * tests/playwright-accounts.json. Specs are READ-ONLY — they must never write
 * to the database; write-flow rehearsal is a separate manual harness.
 */
export default defineConfig({
  testDir: "./e2e",
  timeout: 90_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  use: {
    baseURL: "http://localhost:5173",
    trace: "off",
    screenshot: "off",
    video: "off",
  },
});
