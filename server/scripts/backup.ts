/**
 * scripts/backup.ts
 *
 * Pre-wipe backup: dumps the SMART PostgreSQL database to a timestamped .sql
 * file so the current school's data can be restored if ever needed.
 *
 * Usage:
 *   pnpm run db:backup
 *
 * Requirements:
 *   - pg_dump on PATH, or PG_DUMP_PATH env var, or a standard Windows install
 *     under C:\Program Files\PostgreSQL\<version>\bin
 *
 * Output:
 *   server/backups/smart_db_<timestamp>.sql   (gitignored)
 */

import dotenv from "dotenv";
import path from "path";
import fs from "fs";
import { execFileSync } from "child_process";

dotenv.config({ path: path.resolve(__dirname, "../.env") });

function fail(message: string): never {
  console.error(`[backup] ${message}`);
  process.exit(1);
}

if (!process.env.DATABASE_URL) {
  fail("DATABASE_URL is not set (expected in server/.env).");
}

function findPgDump(): string {
  const exe = process.platform === "win32" ? "pg_dump.exe" : "pg_dump";

  const explicit = process.env.PG_DUMP_PATH;
  if (explicit) {
    if (fs.existsSync(explicit)) return explicit;
    fail(`PG_DUMP_PATH points to a missing file: ${explicit}`);
  }

  for (const dir of (process.env.PATH ?? "").split(path.delimiter)) {
    if (!dir) continue;
    const candidate = path.join(dir, exe);
    if (fs.existsSync(candidate)) return candidate;
  }

  if (process.platform === "win32") {
    const base = "C:\\Program Files\\PostgreSQL";
    if (fs.existsSync(base)) {
      const versions = fs
        .readdirSync(base)
        .filter((v) => /^\d+/.test(v))
        .sort((a, b) => Number(b) - Number(a));
      for (const version of versions) {
        const candidate = path.join(base, version, "bin", exe);
        if (fs.existsSync(candidate)) return candidate;
      }
    }
  }

  fail("pg_dump not found. Add PostgreSQL bin to PATH or set PG_DUMP_PATH.");
}

const backupDir = process.env.BACKUP_DIR ?? path.resolve(__dirname, "../backups");
fs.mkdirSync(backupDir, { recursive: true });

const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
const outFile = path.join(backupDir, `smart_db_${stamp}.sql`);

const pgDump = findPgDump();
console.log(`[backup] Using ${pgDump}`);
console.log(`[backup] Dumping database to ${outFile} ...`);

try {
  execFileSync(
    pgDump,
    ["--no-owner", "--no-privileges", "--file", outFile, "--dbname", process.env.DATABASE_URL],
    { stdio: ["ignore", "inherit", "inherit"] },
  );
} catch (err) {
  const message = err instanceof Error ? err.message : String(err);
  fail(`pg_dump failed: ${message}`);
}

const sizeMb = fs.statSync(outFile).size / (1024 * 1024);
console.log(`[backup] Done. ${sizeMb.toFixed(2)} MB -> ${outFile}`);
console.log("[backup] Keep this file until after the presentation. Restore with:");
console.log(`[backup]   psql "<database-url>" < "${outFile}"`);
