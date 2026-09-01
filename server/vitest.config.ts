import { defineConfig } from "vitest/config";
import dotenv from "dotenv";

dotenv.config();

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
