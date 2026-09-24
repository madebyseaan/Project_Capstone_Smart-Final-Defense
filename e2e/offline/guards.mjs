/**
 * guards.mjs — fail-closed environment guards for the offline rig.
 *
 * Rules (plan §1.3):
 *  - DATABASE_URL must come from the process environment and target a *_test database.
 *  - ENROLLPRO_URL and ATLAS_URL must be loopback.
 *  - AIMS_URL, when set, must be loopback.
 *
 * Usage:
 *   node e2e/offline/guards.mjs            # check process.env, exit 1 on violation
 *   node e2e/offline/guards.mjs --selftest # run built-in checks
 */
import process from "node:process";

export function dbNameFromUrl(url) {
  try {
    return new URL(url).pathname.replace(/^\//, "");
  } catch {
    return "";
  }
}

export function isLoopback(url) {
  try {
    const { hostname } = new URL(url);
    return ["127.0.0.1", "localhost", "::1"].includes(hostname);
  } catch {
    return false;
  }
}

export function checkRigEnv(env = process.env) {
  const errors = [];
  const db = dbNameFromUrl(env.DATABASE_URL ?? "");

  if (!env.DATABASE_URL) {
    errors.push("DATABASE_URL is not set (rig requires it in the process env, not server/.env)");
  } else if (!/(^|_)test(_|$)/i.test(db)) {
    errors.push(`DATABASE_URL must target a *_test database (got "${db || "unparseable"}")`);
  }

  for (const key of ["ENROLLPRO_URL", "ATLAS_URL"]) {
    if (!env[key]) errors.push(`${key} is not set (rig must point it at a loopback stub)`);
    else if (!isLoopback(env[key])) errors.push(`${key} must be loopback (got "${env[key]}")`);
  }

  if (env.AIMS_URL && !isLoopback(env.AIMS_URL)) {
    errors.push(`AIMS_URL must be loopback when set (got "${env.AIMS_URL}")`);
  }

  return {
    ok: errors.length === 0,
    errors,
    info: {
      db,
      enrollpro: env.ENROLLPRO_URL ?? null,
      atlas: env.ATLAS_URL ?? null,
      aims: env.AIMS_URL ?? null,
    },
  };
}

function selftest() {
  const base = {
    DATABASE_URL: "postgresql://u:p@127.0.0.1:5432/smart_test_db",
    ENROLLPRO_URL: "http://127.0.0.1:5999/api",
    ATLAS_URL: "http://127.0.0.1:5998/api/v1",
    AIMS_URL: "http://127.0.0.1:5997/api/v1",
  };
  const cases = [
    ["valid rig env", base, true],
    ["missing DATABASE_URL", { ...base, DATABASE_URL: undefined }, false],
    ["prod DB name", { ...base, DATABASE_URL: "postgresql://u:p@host/smart_db" }, false],
    ["remote EnrollPro", { ...base, ENROLLPRO_URL: "https://real-ep.example.com/api" }, false],
    ["remote Atlas", { ...base, ATLAS_URL: "https://real-atlas.example.com/api/v1" }, false],
    ["remote AIMS", { ...base, AIMS_URL: "http://100.92.245.14:5000/api/v1" }, false],
    ["AIMS unset is allowed", { ...base, AIMS_URL: undefined }, true],
  ];

  let failed = 0;
  for (const [name, env, expectedOk] of cases) {
    const result = checkRigEnv(env);
    const pass = result.ok === expectedOk;
    if (!pass) failed += 1;
    console.log(`${pass ? "PASS" : "FAIL"}  ${name} (expected ok=${expectedOk}, got ${result.ok})`);
    if (!pass) console.log(`      errors: ${result.errors.join("; ")}`);
  }
  console.log(failed === 0 ? "\n[guards] selftest PASSED" : `\n[guards] selftest FAILED (${failed})`);
  process.exit(failed === 0 ? 0 : 1);
}

const invokedDirectly = process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, "/").split("/").pop());
if (invokedDirectly && process.argv.includes("--selftest")) {
  selftest();
} else if (invokedDirectly) {
  const result = checkRigEnv();
  console.log("[guards] rig env:", JSON.stringify(result.info));
  if (!result.ok) {
    for (const err of result.errors) console.error(`[guards] REFUSED: ${err}`);
    process.exit(1);
  }
  console.log("[guards] OK");
}
