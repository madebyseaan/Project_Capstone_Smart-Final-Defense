import dotenv from "dotenv";
import path from "path";

// Load environment variables with explicit path
dotenv.config({ path: path.resolve(__dirname, "../.env") });

import { validateEnv } from "./config/env";

// Validate environment variables — crashes if critical vars are missing
validateEnv();

// ── Global error handlers — prevent silent crashes ────────────────────────
process.on("unhandledRejection", (reason, promise) => {
  console.error("[FATAL] Unhandled Promise Rejection:", reason);
  // Don't exit — let the server keep running
});

process.on("uncaughtException", (err) => {
  console.error("[FATAL] Uncaught Exception:", err.message);
  console.error(err.stack);
  // Don't exit — ts-node-dev will respawn if needed
});

import express from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import authRoutes from "./routes/auth";
import gradesRoutes from "./routes/grades";
import advisoryRoutes from "./routes/advisory";
import registrarRoutes from "./routes/registrar";
import adminRoutes from "./routes/admin";
import attendanceRoutes from "./routes/attendance";
import templateRoutes from "./routes/templates";
import syncRoutes from "./routes/sync";
import integrationRoutes from "./routes/integration";
import { startUnifiedSyncScheduler, stopUnifiedSyncScheduler } from "./lib/syncCoordinator";
import { prisma } from "./lib/prisma";
import { globalLimiter } from "./middleware/rateLimiter";
import { csrfProtection } from "./middleware/csrf";
import { auditContextMiddleware } from "./middleware/auditContext";
import { loadSecurityPolicy } from "./lib/securityPolicy";

const app = express();
const PORT = process.env.PORT || 5003;

// Trust proxy (needed for accurate req.ip behind reverse proxy)
app.set("trust proxy", 1);

// CORS — configurable via CORS_ORIGIN env var (comma-separated)
const defaultOrigins = ["http://localhost:5173", "http://localhost:5174", "http://localhost:5175", "http://localhost:3000"];
const envOrigins = process.env.CORS_ORIGIN
  ? process.env.CORS_ORIGIN.split(',').map(s => s.trim()).filter(Boolean)
  : [];
const allowedOrigins = envOrigins.length > 0 ? envOrigins : defaultOrigins;

// Middleware
app.use(cookieParser());
app.use(cors({
  origin: allowedOrigins,
  credentials: true,
}));
app.use(express.json());

// Attach request audit context (IP / network / device) for all routes
app.use(auditContextMiddleware);

// Global rate limiter
app.use("/api", globalLimiter);

// CSRF protection (double-submit cookie pattern) — skip /api/auth (no session to forge yet)
app.use(csrfProtection);

// Serve uploaded files
app.use("/uploads", express.static(path.join(__dirname, "../uploads")));

// Routes
app.use("/api/auth", authRoutes);
app.use("/api/grades", gradesRoutes);
app.use("/api/advisory", advisoryRoutes);
app.use("/api/registrar", registrarRoutes);
app.use("/api/admin", adminRoutes);
app.use("/api/attendance", attendanceRoutes);
app.use("/api/templates", templateRoutes);
app.use("/api/sync", syncRoutes);
app.use("/api/integration", integrationRoutes);

// Health check
app.get("/api/health", (_req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

// Serve React frontend (production build)
const distPath = path.join(__dirname, "../../dist");
app.use(express.static(distPath));
app.get("*splat", (_req, res) => {
  res.sendFile(path.join(distPath, "index.html"));
});

/**
 * Fix existing SPA/SPS subjects that were incorrectly typed as CORE during earlier syncs.
 * SPA and SPS follow MAPEH weight groups (20/60/20), not CORE (20/50/30).
 */
async function reclassifySpecialProgramSubjects(): Promise<void> {
  try {
    const misclassified = await prisma.subject.findMany({
      where: {
        type: 'CORE',
        OR: [
          { code: { startsWith: 'SPA_' } },
          { code: { equals: 'SPA' } },
          { code: { startsWith: 'SPS_' } },
          { code: { equals: 'SPS' } },
        ],
      },
      select: { id: true, code: true, name: true },
    });

    if (misclassified.length === 0) return;

    const ids = misclassified.map(s => s.id);
    await prisma.subject.updateMany({
      where: { id: { in: ids } },
      data: { type: 'MAPEH' },
    });
    console.log(
      `[Startup] Reclassified ${ids.length} SPA/SPS subject(s) from CORE → MAPEH:`,
      misclassified.map(s => s.code).join(', '),
    );
  } catch (err: any) {
    console.error('[Startup] Failed to reclassify SPA/SPS subjects:', err.message);
  }
}

/**
 * Auto-seed the transmutation table if empty.
 * Ensures the 41 DepEd default rows exist on first server start after DB creation.
 */
async function autoSeedTransmutationTable(): Promise<void> {
  try {
    const count = await prisma.transmutationEntry.count();
    if (count > 0) return;

    // Adjusted Transmutation Table (DepEd Order No. 015, s. 2026) — SY 2026-2027.
    const defaults = [
      { minGrade: 0.00, maxGrade: 4.67, transmutedGrade: 60 },
      { minGrade: 4.68, maxGrade: 9.34, transmutedGrade: 61 },
      { minGrade: 9.35, maxGrade: 14.00, transmutedGrade: 62 },
      { minGrade: 14.01, maxGrade: 18.67, transmutedGrade: 63 },
      { minGrade: 18.68, maxGrade: 23.34, transmutedGrade: 64 },
      { minGrade: 23.35, maxGrade: 28.00, transmutedGrade: 65 },
      { minGrade: 28.01, maxGrade: 32.67, transmutedGrade: 66 },
      { minGrade: 32.68, maxGrade: 37.33, transmutedGrade: 67 },
      { minGrade: 37.34, maxGrade: 42.00, transmutedGrade: 68 },
      { minGrade: 42.01, maxGrade: 46.66, transmutedGrade: 69 },
      { minGrade: 46.67, maxGrade: 51.33, transmutedGrade: 70 },
      { minGrade: 51.34, maxGrade: 56.00, transmutedGrade: 71 },
      { minGrade: 56.01, maxGrade: 60.66, transmutedGrade: 72 },
      { minGrade: 60.67, maxGrade: 65.33, transmutedGrade: 73 },
      { minGrade: 65.34, maxGrade: 69.99, transmutedGrade: 74 },
      { minGrade: 70.00, maxGrade: 71.17, transmutedGrade: 75 },
      { minGrade: 71.18, maxGrade: 72.35, transmutedGrade: 76 },
      { minGrade: 72.36, maxGrade: 73.53, transmutedGrade: 77 },
      { minGrade: 73.54, maxGrade: 74.71, transmutedGrade: 78 },
      { minGrade: 74.72, maxGrade: 75.89, transmutedGrade: 79 },
      { minGrade: 75.90, maxGrade: 77.07, transmutedGrade: 80 },
      { minGrade: 77.08, maxGrade: 78.25, transmutedGrade: 81 },
      { minGrade: 78.26, maxGrade: 79.43, transmutedGrade: 82 },
      { minGrade: 79.44, maxGrade: 80.61, transmutedGrade: 83 },
      { minGrade: 80.62, maxGrade: 81.79, transmutedGrade: 84 },
      { minGrade: 81.80, maxGrade: 82.97, transmutedGrade: 85 },
      { minGrade: 82.98, maxGrade: 84.15, transmutedGrade: 86 },
      { minGrade: 84.16, maxGrade: 85.33, transmutedGrade: 87 },
      { minGrade: 85.34, maxGrade: 86.51, transmutedGrade: 88 },
      { minGrade: 86.52, maxGrade: 87.69, transmutedGrade: 89 },
      { minGrade: 87.70, maxGrade: 88.87, transmutedGrade: 90 },
      { minGrade: 88.88, maxGrade: 90.05, transmutedGrade: 91 },
      { minGrade: 90.06, maxGrade: 91.23, transmutedGrade: 92 },
      { minGrade: 91.24, maxGrade: 92.41, transmutedGrade: 93 },
      { minGrade: 92.42, maxGrade: 93.59, transmutedGrade: 94 },
      { minGrade: 93.60, maxGrade: 94.77, transmutedGrade: 95 },
      { minGrade: 94.78, maxGrade: 95.95, transmutedGrade: 96 },
      { minGrade: 95.96, maxGrade: 97.13, transmutedGrade: 97 },
      { minGrade: 97.14, maxGrade: 98.31, transmutedGrade: 98 },
      { minGrade: 98.32, maxGrade: 99.49, transmutedGrade: 99 },
      { minGrade: 99.50, maxGrade: 100.00, transmutedGrade: 100 },
    ];

    await prisma.transmutationEntry.createMany({
      data: defaults.map(e => ({ ...e, isDefault: true })),
    });
    console.log(`[Startup] Seeded ${defaults.length} DepEd transmutation entries.`);
  } catch (err: any) {
    console.error('[Startup] Failed to auto-seed transmutation table:', err.message);
  }
}

// Start server
const server = app.listen(PORT, async () => {
  console.log(`Server running on http://localhost:${PORT}`);

  // Startup validation: warn if critical env vars are missing
  if (!process.env.CSRF_SECRET && !process.env.JWT_SECRET) {
    console.warn("[Startup] WARNING: Neither CSRF_SECRET nor JWT_SECRET is set. CSRF protection uses fallback secret.");
  }

  // Signal PM2 the server is listening (health endpoint is ready now)
  if (typeof process.send === "function") {
    process.send("ready");
  }
  // Fix SPA/SPS subject types (one-time cleanup, safe to run on every start)
  await reclassifySpecialProgramSubjects();
  // Auto-seed transmutation table if empty (safe to run on every start)
  await autoSeedTransmutationTable();
  // Load enforced security policy (login attempts / password rules)
  await loadSecurityPolicy();
  // Start unified sync scheduler to periodically sync EnrollPro and ATLAS
  startUnifiedSyncScheduler();
  // Start auto-term advancement scheduler
  startAutoTermScheduler();
  // Start retention cleanup scheduler
  startRetentionCleanupScheduler();
});

// ── Graceful Shutdown ───────────────────────────────────────────────────────
// Handles SIGTERM (PM2/Docker) and SIGINT (Ctrl+C) to drain connections
// before exiting. Prevents dropped in-flight requests during deploys.
let isShuttingDown = false;

async function gracefulShutdown(signal: string) {
  if (isShuttingDown) return;
  isShuttingDown = true;
  console.log(`\n[Shutdown] ${signal} received. Starting graceful shutdown...`);

  // 1. Stop accepting new connections
  server.close(() => {
    console.log("[Shutdown] HTTP server closed.");
  });

  // 2. Stop background schedulers
  try {
    stopUnifiedSyncScheduler();
    console.log("[Shutdown] Sync scheduler stopped.");
  } catch {
    // Ignore — may not be initialized
  }

  // 3. Close database connections
  try {
    await prisma.$disconnect();
    console.log("[Shutdown] Database connections closed.");
  } catch (err) {
    console.error("[Shutdown] Error closing database:", err);
  }

  // 4. Force exit after 10 seconds if something hangs
  setTimeout(() => {
    console.error("[Shutdown] Forced exit after timeout.");
    process.exit(1);
  }, 10_000).unref();

  process.exit(0);
}

process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
process.on("SIGINT", () => gracefulShutdown("SIGINT"));

// ── Auto-Term Advancement Scheduler ────────────────────────────────────────
// Checks every hour if the current term has ended and advances to the next term.
// Also auto-locks grades when a term end date passes.
function startAutoTermScheduler() {
  const CHECK_INTERVAL_MS = 60 * 60 * 1000; // 1 hour

  const checkAndAdvanceTerm = async () => {
    try {
      const { prisma } = await import("./lib/prisma");
      
      const settings = await prisma.systemSettings.findUnique({ where: { id: "main" } });
      if (!settings) return;

      const now = new Date();
      const { t1EndDate, t2EndDate, t3EndDate } = settings;

      // NOTE: Term advancement is handled exclusively by resolveCurrentTerm()
      // which queries EnrollPro's /integration/v1/active-term live.
      // The scheduler does NOT advance terms — that would conflict with the live source of truth.

      // Auto-lock per-term / per-year when term end dates pass (never writes term state).
      // Cross-checks EnrollPro's live active-term before locking — if EnrollPro still
      // considers the term active, we skip locking even if the local date has passed.
      // This prevents premature locking when local term dates are stale or derived.
      try {
        const { getActiveSchoolYear } = await import("./lib/schoolYearResolver");
        const { setTermLock, setYearLock } = await import("./lib/gradeLocks");
        const { getIntegrationV1ActiveTerm } = await import("./lib/enrollproClient");
        const { createAuditLog } = await import("./lib/audit");
        const { isDemoTermMode } = await import("./lib/demoTermMode");
        const { AuditAction, AuditSeverity } = await import("@prisma/client");
        const activeYear = await getActiveSchoolYear();
        const actor = { id: "scheduler", name: "Auto-Term Scheduler" };
        const auditActor = { id: "scheduler", firstName: "Auto-Term", lastName: "Scheduler", role: "ADMIN" };

        // Fetch live active term from EnrollPro — this is the source of truth
        // DEMO-only: skipped when DEMO_TERM_MODE is on (date-based locking).
        let enrollProActiveTerm: string | null = null;
        if (!isDemoTermMode()) {
          try {
            const epTerm = await getIntegrationV1ActiveTerm();
            if (epTerm?.activeTerm && ['T1', 'T2', 'T3'].includes(epTerm.activeTerm.toUpperCase())) {
              enrollProActiveTerm = epTerm.activeTerm.toUpperCase();
            }
          } catch {
            // EnrollPro unreachable — fall back to date-based locking
          }
        }

        const termEndDates: Record<string, Date | null> = {
          T1: t1EndDate,
          T2: t2EndDate,
          T3: t3EndDate,
        };

        // Load current lock state to detect premature locks
        const { getGradeLockState } = await import("./lib/gradeLocks");
        const lockState = await getGradeLockState(activeYear.label);

        for (const term of ["T1", "T2", "T3"] as const) {
          const endDate = termEndDates[term];
          if (endDate && now > endDate) {
            // Only lock if EnrollPro does NOT consider this term active
            if (enrollProActiveTerm !== term) {
              const wasLocked = lockState.termLocks[term];
              await setTermLock(activeYear.id, term, true, actor);
              if (!wasLocked) {
                await createAuditLog(
                  AuditAction.CONFIG, auditActor,
                  `Term Grade Lock: ${activeYear.label} ${term}`,
                  "Config",
                  `Auto-locked ${term} — its end date ${endDate.toISOString()} has passed and EnrollPro active term is ${enrollProActiveTerm ?? "unknown"}.`,
                  undefined, AuditSeverity.WARNING,
                );
              }
            } else {
              console.log(`[Scheduler] Skipping lock for ${term} — EnrollPro still reports it as active (local endDate=${endDate.toISOString()}, EnrollPro activeTerm=${enrollProActiveTerm})`);
              // Auto-unlock: if prematurely locked, unlock to mirror EnrollPro
              if (lockState.termLocks[term]) {
                await setTermLock(activeYear.id, term, false, actor);
                await createAuditLog(
                  AuditAction.CONFIG, auditActor,
                  `Term Grade Lock: ${activeYear.label} ${term}`,
                  "Config",
                  `Auto-unlocked ${term} — it was locked but EnrollPro still reports it as active.`,
                  undefined, AuditSeverity.WARNING,
                );
                console.log(`[Scheduler] Auto-unlocked ${term} — was locked but EnrollPro still considers it active`);
              }
            }
          }
        }
        if (t3EndDate && now > t3EndDate && enrollProActiveTerm !== 'T3') {
          await setYearLock(activeYear.id, true, actor);
          if (!lockState.yearLocked) {
            await createAuditLog(
              AuditAction.CONFIG, auditActor,
              `Year Grade Lock: ${activeYear.label}`,
              "Config",
              `Auto-locked school year ${activeYear.label} — T3 end date ${t3EndDate.toISOString()} has passed and EnrollPro active term is ${enrollProActiveTerm ?? "unknown"}.`,
              undefined, AuditSeverity.WARNING,
            );
          }
        }
      } catch (err: any) {
        console.error("[Scheduler] Failed to apply per-term/year grade locks:", err.message);
      }

      // Auto-expire grade edit requests
      const expiredRequests = await prisma.gradeEditRequest.updateMany({
        where: {
          status: "APPROVED",
          expiresAt: { lt: now },
        },
        data: { status: "EXPIRED" },
      });
      if (expiredRequests.count > 0) {
        console.log(`[Scheduler] Auto-expired ${expiredRequests.count} grade edit request(s)`);
      }
    } catch (err: any) {
      console.error("[Scheduler] Auto-term check failed:", err.message);
    }
  };

  // Run on startup after a short delay
  setTimeout(checkAndAdvanceTerm, 10_000);
  // Then run every hour
  setInterval(checkAndAdvanceTerm, CHECK_INTERVAL_MS);
  console.log("[Scheduler] Auto-term advancement scheduler started (checks every 1 hour)");
}

function startRetentionCleanupScheduler() {
  const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;

  const runCleanup = async () => {
    try {
      const settings = await prisma.systemSettings.findUnique({ where: { id: "main" } });
      if (!settings) return;
      const now = new Date();

      if (settings.auditLogRetentionDays > 0) {
        const cutoff = new Date(now.getTime() - settings.auditLogRetentionDays * 86400000);
        const { count } = await prisma.auditLog.deleteMany({ where: { createdAt: { lt: cutoff } } });
        if (count > 0) console.log(`[Retention] Deleted ${count} audit log(s) older than ${settings.auditLogRetentionDays} days`);
      }

      if (settings.syncHistoryRetentionDays > 0) {
        const cutoff = new Date(now.getTime() - settings.syncHistoryRetentionDays * 86400000);
        const { count } = await prisma.syncHistory.deleteMany({ where: { createdAt: { lt: cutoff } } });
        if (count > 0) console.log(`[Retention] Deleted ${count} sync history record(s) older than ${settings.syncHistoryRetentionDays} days`);
      }

      if (settings.gradeSnapshotRetentionDays > 0) {
        const cutoff = new Date(now.getTime() - settings.gradeSnapshotRetentionDays * 86400000);
        const count = await prisma.$executeRaw`
          DELETE FROM "GradeSnapshot" WHERE id IN (
            SELECT id FROM "GradeSnapshot"
            WHERE "createdAt" < ${cutoff}
            AND id NOT IN (
              SELECT DISTINCT ON ("studentId", "classAssignmentId", "term") id
              FROM "GradeSnapshot"
              WHERE "createdAt" < ${cutoff}
              ORDER BY "studentId", "classAssignmentId", "term", "createdAt" DESC
            )
          )`;
        if (count > 0) console.log(`[Retention] Cleaned ${count} old grade snapshot(s)`);
      }
    } catch (err: any) {
      console.error("[Retention] Cleanup failed:", err.message);
    }
  };

  setTimeout(runCleanup, 30_000);
  setInterval(runCleanup, CHECK_INTERVAL_MS);
  console.log("[Scheduler] Retention cleanup scheduler started (runs daily)");
}

