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

    const defaults = [
      { minGrade: 99.50, maxGrade: 100.00, transmutedGrade: 100 },
      { minGrade: 97.50, maxGrade: 99.49, transmutedGrade: 99 },
      { minGrade: 96.00, maxGrade: 97.49, transmutedGrade: 98 },
      { minGrade: 95.00, maxGrade: 95.99, transmutedGrade: 97 },
      { minGrade: 94.00, maxGrade: 94.99, transmutedGrade: 96 },
      { minGrade: 93.00, maxGrade: 93.99, transmutedGrade: 95 },
      { minGrade: 92.00, maxGrade: 92.99, transmutedGrade: 94 },
      { minGrade: 91.00, maxGrade: 91.99, transmutedGrade: 93 },
      { minGrade: 90.00, maxGrade: 90.99, transmutedGrade: 92 },
      { minGrade: 89.00, maxGrade: 89.99, transmutedGrade: 91 },
      { minGrade: 88.00, maxGrade: 88.99, transmutedGrade: 90 },
      { minGrade: 87.00, maxGrade: 87.99, transmutedGrade: 89 },
      { minGrade: 86.00, maxGrade: 86.99, transmutedGrade: 88 },
      { minGrade: 85.00, maxGrade: 85.99, transmutedGrade: 87 },
      { minGrade: 84.00, maxGrade: 84.99, transmutedGrade: 86 },
      { minGrade: 83.00, maxGrade: 83.99, transmutedGrade: 85 },
      { minGrade: 82.00, maxGrade: 82.99, transmutedGrade: 84 },
      { minGrade: 81.00, maxGrade: 81.99, transmutedGrade: 83 },
      { minGrade: 80.00, maxGrade: 80.99, transmutedGrade: 82 },
      { minGrade: 79.00, maxGrade: 79.99, transmutedGrade: 81 },
      { minGrade: 78.00, maxGrade: 78.99, transmutedGrade: 80 },
      { minGrade: 77.00, maxGrade: 77.99, transmutedGrade: 79 },
      { minGrade: 76.00, maxGrade: 76.99, transmutedGrade: 78 },
      { minGrade: 75.00, maxGrade: 75.99, transmutedGrade: 77 },
      { minGrade: 73.00, maxGrade: 74.99, transmutedGrade: 76 },
      { minGrade: 70.00, maxGrade: 72.99, transmutedGrade: 75 },
      { minGrade: 68.00, maxGrade: 69.99, transmutedGrade: 74 },
      { minGrade: 66.00, maxGrade: 67.99, transmutedGrade: 73 },
      { minGrade: 64.00, maxGrade: 65.99, transmutedGrade: 72 },
      { minGrade: 62.00, maxGrade: 63.99, transmutedGrade: 71 },
      { minGrade: 60.00, maxGrade: 61.99, transmutedGrade: 70 },
      { minGrade: 58.00, maxGrade: 59.99, transmutedGrade: 69 },
      { minGrade: 56.00, maxGrade: 57.99, transmutedGrade: 68 },
      { minGrade: 54.00, maxGrade: 55.99, transmutedGrade: 67 },
      { minGrade: 52.00, maxGrade: 53.99, transmutedGrade: 66 },
      { minGrade: 50.00, maxGrade: 51.99, transmutedGrade: 65 },
      { minGrade: 48.00, maxGrade: 49.99, transmutedGrade: 64 },
      { minGrade: 46.00, maxGrade: 47.99, transmutedGrade: 63 },
      { minGrade: 43.00, maxGrade: 45.99, transmutedGrade: 62 },
      { minGrade: 40.00, maxGrade: 42.99, transmutedGrade: 61 },
      { minGrade: 0.00, maxGrade: 39.99, transmutedGrade: 60 },
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

      // Auto-lock per-term / per-year when term end dates pass (never writes term state)
      try {
        const { getActiveSchoolYear } = await import("./lib/schoolYearResolver");
        const { setTermLock, setYearLock } = await import("./lib/gradeLocks");
        const activeYear = await getActiveSchoolYear();
        const actor = { id: "scheduler", name: "Auto-Term Scheduler" };
        const termEndDates: Record<string, Date | null> = {
          T1: t1EndDate,
          T2: t2EndDate,
          T3: t3EndDate,
        };
        for (const term of ["T1", "T2", "T3"] as const) {
          const endDate = termEndDates[term];
          if (endDate && now > endDate) {
            await setTermLock(activeYear.id, term, true, actor);
          }
        }
        if (t3EndDate && now > t3EndDate) {
          await setYearLock(activeYear.id, true, actor);
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

