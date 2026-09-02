/**
 * Environment variable validation.
 * Runs at startup — crashes the process if required vars are missing.
 */

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    console.error(`\n[FATAL] Missing required environment variable: ${name}`);
    console.error(`Add it to server/.env or set it in your environment.\n`);
    process.exit(1);
  }
  return value;
}

/**
 * Validate all required environment variables.
 * Call this once at server startup, before any other code runs.
 */
export function validateEnv(): void {
  requireEnv("JWT_SECRET");
  requireEnv("DATABASE_URL");

  const jwtSecret = process.env.JWT_SECRET!;
  if (jwtSecret.length < 32) {
    console.warn(`[WARN] JWT_SECRET is only ${jwtSecret.length} characters. Recommended: 64+ characters.`);
  }
  if (jwtSecret === "fallback-secret") {
    console.error("\n[FATAL] JWT_SECRET is set to the insecure default 'fallback-secret'.");
    console.error("Generate a secure secret: node -e \"console.log(require('crypto').randomBytes(64).toString('hex'))\"\n");
    process.exit(1);
  }

  // Production: verify school-scoped env vars are set
  if (isProduction()) {
    const schoolVars = [
      "ENROLLPRO_SCHOOL_YEAR_ID",
      "ATLAS_SCHOOL_ID",
      "ATLAS_SCHOOL_YEAR_ID",
    ];
    const missing = schoolVars.filter((v) => !process.env[v]);
    if (missing.length > 0) {
      console.error("\n[FATAL] Missing school-scoped environment variables (required in production):");
      for (const v of missing) {
        console.error(`  - ${v}`);
      }
      console.error("\nSet these in server/.env. Each school deployment MUST have its own values.");
      console.error("Wrong values = wrong students silently synced.\n");
      process.exit(1);
    }
  }
}

/**
 * Get the JWT secret. Crashes if not set.
 */
export function getJwtSecret(): string {
  return requireEnv("JWT_SECRET");
}

/**
 * Check if running in production mode.
 */
export function isProduction(): boolean {
  return process.env.NODE_ENV === "production";
}

/**
 * Check if running in development mode.
 */
export function isDevelopment(): boolean {
  return process.env.NODE_ENV !== "production";
}


