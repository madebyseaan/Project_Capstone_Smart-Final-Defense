import { defineConfig } from "vitest/config";
import dotenv from "dotenv";

dotenv.config();

// Refuse to run against the live database: the suite includes destructive
// tests (wipe/rollover/prune) and must only ever touch an isolated *_test DB.
const guardDbName = (() => {
  try {
    return new URL(process.env.DATABASE_URL ?? "").pathname.replace(/^\//, "");
  } catch {
    return "";
  }
})();
if (!/(^|_)test(_|$)/i.test(guardDbName)) {
  throw new Error(
    `[vitest] Refusing to run: DATABASE_URL must target a *_test database (got "${guardDbName || "unparseable"}"). ` +
      `Example: $env:DATABASE_URL="postgresql://user:pass@localhost:5432/smart_test_db"; npm test`,
  );
}

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    testTimeout: 15000,
    hookTimeout: 15000,
    include: ["src/__tests__/**/*.test.ts"],
    // All test files share one PostgreSQL DB — running files in parallel
    // lets one file's seeds/cleanups race another's assertions (and races
    // runWipe's all-tables-empty verification). Serialize files.
    fileParallelism: false,
  },
});
