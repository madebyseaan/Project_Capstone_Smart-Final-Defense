import { defineConfig } from "@playwright/test";
import path from "node:path";

/**
 * Playwright offline rig (T3). Run via `npm run test:e2e:offline`, which seeds the
 * isolated test DB first, then launches this config. Servers:
 *   EP stub :5999 · ATLAS stub :5998 · AIMS stub :5997 · backend :5004 · frontend :5174
 * The dev stack (:5003/:5173) is never touched.
 */
const ROOT = process.cwd();
const PORT = Number(process.env.RIG_PORT ?? 5004);
const VITE_PORT = Number(process.env.VITE_RIG_PORT ?? 5174);

const backendEnv = {
  ...process.env,
  PORT: String(PORT),
  NODE_ENV: "development",
  ENROLLPRO_URL: process.env.ENROLLPRO_URL ?? "http://127.0.0.1:5999/api",
  ATLAS_URL: process.env.ATLAS_URL ?? "http://127.0.0.1:5998/api/v1",
  AIMS_URL: process.env.AIMS_URL ?? "http://127.0.0.1:5997/api/v1",
  AIMS_API_KEY: process.env.AIMS_API_KEY ?? "rig-test-key",
  EP_BREAKER_COOLDOWN_MS: process.env.EP_BREAKER_COOLDOWN_MS ?? "1000",
  SYNC_INTERVAL_MS: process.env.SYNC_INTERVAL_MS ?? "600000",
  SYNC_INITIAL_DELAY_MS: "1500",
};

export default defineConfig({
  testDir: path.join(ROOT, "e2e", "offline", "specs"),
  timeout: 120_000,
  expect: { timeout: 20_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  use: {
    baseURL: `http://127.0.0.1:${VITE_PORT}`,
    trace: "off",
    screenshot: "off",
    video: "off",
  },
  webServer: [
    {
      command: "node e2e/offline/enrollpro-stub.mjs",
      url: "http://127.0.0.1:5999/_control/state",
      cwd: ROOT,
      reuseExistingServer: false,
      timeout: 30_000,
      env: { ...process.env, STUB_PORT: "5999" },
    },
    {
      command: "node e2e/offline/atlas-stub.mjs",
      url: "http://127.0.0.1:5998/_control/state",
      cwd: ROOT,
      reuseExistingServer: false,
      timeout: 30_000,
      env: { ...process.env, ATLAS_STUB_PORT: "5998" },
    },
    {
      command: "node e2e/offline/aims-stub.mjs",
      url: "http://127.0.0.1:5997/_control/state",
      cwd: ROOT,
      reuseExistingServer: false,
      timeout: 30_000,
      env: { ...process.env, AIMS_STUB_PORT: "5997" },
    },
    {
      command: "npm --prefix server run dev",
      url: `http://127.0.0.1:${PORT}/api/health`,
      cwd: ROOT,
      reuseExistingServer: false,
      timeout: 120_000,
      env: backendEnv,
    },
    {
      command: `npx vite --host 127.0.0.1 --port ${VITE_PORT} --strictPort`,
      url: `http://127.0.0.1:${VITE_PORT}`,
      cwd: ROOT,
      reuseExistingServer: false,
      timeout: 120_000,
      env: { ...process.env, VITE_PROXY_TARGET: `http://127.0.0.1:${PORT}`, VITE_PORT: String(VITE_PORT) },
    },
  ],
});
