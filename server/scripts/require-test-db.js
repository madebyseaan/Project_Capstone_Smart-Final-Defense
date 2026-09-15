/**
 * require-test-db.js — Refuses to run the backend test suite unless
 * DATABASE_URL targets an isolated *_test database.
 *
 * The suite includes destructive tests (wipe/rollover/prune); it must never
 * run against the live development database.
 *
 * Usage:
 *   $env:DATABASE_URL="postgresql://user:pass@localhost:5432/smart_test_db"
 *   npm test
 */
const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });

function dbNameFromUrl(url) {
  try {
    return new URL(url).pathname.replace(/^\//, "");
  } catch {
    return "";
  }
}

const dbName = dbNameFromUrl(process.env.DATABASE_URL ?? "");
const isTestDb = (name) => /(^|_)test(_|$)/i.test(name);
if (!isTestDb(dbName)) {
  console.error(
    `[test-guard] Refusing to run: DATABASE_URL must target a *_test database (got "${dbName || "unparseable"}").`,
  );
  console.error(
    '[test-guard] Example: $env:DATABASE_URL="postgresql://user:pass@localhost:5432/smart_test_db"; npm test',
  );
  process.exit(1);
}
console.log(`[test-guard] Using isolated test database: ${dbName}`);
