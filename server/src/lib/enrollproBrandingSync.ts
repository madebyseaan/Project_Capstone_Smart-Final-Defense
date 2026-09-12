/**
 * enrollproBrandingSync.ts
 *
 * Service that syncs school branding (logo, colors, school name) from
 * EnrollPro's public settings endpoint into SMART's local database.
 *
 * Called by:
 *  - POST /api/admin/settings/sync-enrollpro  (on-demand)
 *  - Server startup scheduler (auto-sync)
 */

import { logger } from './logger';

import path from "path";
import fs from "fs";
import https from "https";
import http from "http";
import { prisma } from "./prisma";
import { getEnrollProPublicSettings, getIntegrationV1ActiveTerm, getIntegrationV1ActiveSchoolYear, getEnrollProSchoolYearWithTerms } from "./enrollproClient";
import { ensureSchoolYearFromEnrollPro, invalidateSchoolYearCache } from "./schoolYearResolver";
import { broadcastSettingsUpdate } from "./sseManager";
import { syncActiveYearSnapshot } from "./schoolSettingsSnapshot";
import { isDemoTermMode } from "./demoTermMode";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Pick 3 brand colors from an EnrollPro palette (skip near-white and near-black). */
export function pickColorsFromPalette(
  palette: Array<{ hex: string }>
): { primary: string; secondary: string; accent: string } {
  const vibrant = palette
    .filter((c) => {
      if (!c.hex || c.hex.length < 7) return false;
      const r = parseInt(c.hex.slice(1, 3), 16);
      const g = parseInt(c.hex.slice(3, 5), 16);
      const b = parseInt(c.hex.slice(5, 7), 16);
      const lum = 0.299 * r + 0.587 * g + 0.114 * b;
      return lum > 30 && lum < 210;
    })
    .map((c) => c.hex);
  return {
    primary: vibrant[0] ?? "#10b981",
    secondary: vibrant[1] ?? "#34d399",
    accent: vibrant[2] ?? "#6ee7b7",
  };
}

/** Download the school logo from EnrollPro and save it locally. */
export async function downloadLogoFromEnrollPro(
  logoRelativePath: string,
  uploadDir: string
): Promise<string | null> {
  try {
    const baseHost = (
      process.env.ENROLLPRO_BASE_URL ?? "https://dev-jegs.buru-degree.ts.net/api"
    ).replace(/\/api$/, "");
    const imageUrl = `${baseHost}${logoRelativePath}`;
    const ext = path.extname(logoRelativePath) || ".png";
    const filename = `logo-enrollpro-sync${ext}`;
    const filepath = path.join(uploadDir, filename);

    if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

    await new Promise<void>((resolve, reject) => {
      const parsed = new URL(imageUrl);
      const lib = parsed.protocol === "https:" ? https : http;
      const reqOpts: Record<string, any> = {
        hostname: parsed.hostname,
        port: parsed.port ? parseInt(parsed.port) : parsed.protocol === "https:" ? 443 : 80,
        path: parsed.pathname,
        method: "GET",
        rejectUnauthorized: false, // Allow Tailscale internal certs
      };
      const req = (lib as any).request(reqOpts, (res: any) => {
        if (res.statusCode >= 400) {
          reject(new Error(`Logo download failed: HTTP ${res.statusCode}`));
          return;
        }
        const ws = fs.createWriteStream(filepath);
        res.pipe(ws);
        ws.on("finish", resolve);
        ws.on("error", reject);
      });
      req.on("error", (err: Error) => reject(err));
      req.setTimeout(20000, () => {
        req.destroy(new Error("Logo download timeout"));
      });
      req.end();
    });

    return `/uploads/${filename}`;
  } catch (err) {
    console.error("[BrandingSync] Failed to download logo:", err instanceof Error ? err.message : err);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Main sync function
// ---------------------------------------------------------------------------

export async function syncEnrollProBranding(uploadDir?: string): Promise<object> {
  const epSettings = await getEnrollProPublicSettings();
  const resolvedUploadDir = uploadDir ?? path.join(__dirname, "../../uploads");

  // DEMO-only: when on, term dates and the current term are managed locally and
  // must NOT be overwritten by EnrollPro. Branding/identity still syncs.
  const demoMode = isDemoTermMode();

  // Pick colors from palette; fall back to neutral green if palette is empty
  const colors =
    epSettings.colorScheme?.palette?.length
      ? pickColorsFromPalette(epSettings.colorScheme.palette)
      : { primary: "#10b981", secondary: "#34d399", accent: "#6ee7b7" };

  // Download logo locally so it's served by SMART
  const logoUrl = epSettings.logoUrl
    ? await downloadLogoFromEnrollPro(epSettings.logoUrl, resolvedUploadDir)
    : null;

  const updateData: Record<string, any> = {
    primaryColor: colors.primary,
    secondaryColor: colors.secondary,
    accentColor: colors.accent,
    lastEnrollProSync: new Date(),
  };

  if (epSettings.schoolName) updateData.schoolName = epSettings.schoolName;
  if (epSettings.schoolHeadName) updateData.schoolHeadName = epSettings.schoolHeadName;
  if (logoUrl) updateData.logoUrl = logoUrl;
  if (epSettings.activeSchoolYearLabel) updateData.currentSchoolYear = epSettings.activeSchoolYearLabel;
  if (epSettings.depedEmail) updateData.email = epSettings.depedEmail;

  // ── Sync term dates from EnrollPro (3-tier fallback) ───────────────────────
  // Tier 1: Fetch from /api/school-years/:id (admin auth) — most reliable source
  // Tier 2: Use terms[] array from /settings/public (if available)
  // Tier 3: Derive approximate dates from classOpeningDate/classEndDate
  // DEMO-only: skipped entirely when DEMO_TERM_MODE is on (dates managed locally).

  let termDatesSynced = false;
  if (!demoMode) {

  // Tier 1: School-years admin endpoint (flat fields: term1Start, term1End, etc.)
  if (epSettings.activeSchoolYearId && !termDatesSynced) {
    try {
      const yearDetails = await getEnrollProSchoolYearWithTerms(epSettings.activeSchoolYearId);
      if (yearDetails?.term1Start && yearDetails?.term1End) {
        updateData.t1StartDate = new Date(yearDetails.term1Start);
        updateData.t1EndDate = new Date(yearDetails.term1End);
        if (yearDetails.term2Start && yearDetails.term2End) {
          updateData.t2StartDate = new Date(yearDetails.term2Start);
          updateData.t2EndDate = new Date(yearDetails.term2End);
        }
        if (yearDetails.term3Start && yearDetails.term3End) {
          updateData.t3StartDate = new Date(yearDetails.term3Start);
          updateData.t3EndDate = new Date(yearDetails.term3End);
        }
        updateData.termDatesDerived = false;
        termDatesSynced = true;
        logger.info(`[BrandingSync] Synced term dates from EnrollPro /school-years/${epSettings.activeSchoolYearId}: T1=${yearDetails.term1Start?.slice(0,10)}-${yearDetails.term1End?.slice(0,10)}, T2=${yearDetails.term2Start?.slice(0,10)}-${yearDetails.term2End?.slice(0,10)}, T3=${yearDetails.term3Start?.slice(0,10)}-${yearDetails.term3End?.slice(0,10)}`);
      }
    } catch (err: any) {
      logger.warn(`[BrandingSync] Failed to fetch term dates from school-years endpoint: ${err.message}`);
    }
  }

  // Tier 2: Public settings terms[] array (if available)
  if (!termDatesSynced && epSettings.terms && Array.isArray(epSettings.terms) && epSettings.terms.length > 0) {
    const termMap: Record<string, { start: string; end: string }> = {};
    for (const term of epSettings.terms) {
      const raw = (term.label ?? '').trim().toUpperCase();
      const numMatch = raw.match(/(?:TERM\s*)?(\d)/);
      const num = numMatch?.[1];
      if (num && ['1', '2', '3'].includes(num)) {
        const key = `T${num}`;
        if (term.startDate && term.endDate) {
          termMap[key] = { start: term.startDate, end: term.endDate };
        }
      }
    }
    if (termMap.T1) {
      updateData.t1StartDate = new Date(termMap.T1.start);
      updateData.t1EndDate = new Date(termMap.T1.end);
    }
    if (termMap.T2) {
      updateData.t2StartDate = new Date(termMap.T2.start);
      updateData.t2EndDate = new Date(termMap.T2.end);
    }
    if (termMap.T3) {
      updateData.t3StartDate = new Date(termMap.T3.start);
      updateData.t3EndDate = new Date(termMap.T3.end);
    }
    updateData.termDatesDerived = false;
    termDatesSynced = true;
    logger.info(`[BrandingSync] Synced term dates from EnrollPro /settings/public terms[]: T1=${termMap.T1?.start || 'N/A'}-${termMap.T1?.end || 'N/A'}, T2=${termMap.T2?.start || 'N/A'}-${termMap.T2?.end || 'N/A'}, T3=${termMap.T3?.start || 'N/A'}-${termMap.T3?.end || 'N/A'}`);
  }

  // Tier 3: Derive approximate dates from school year boundaries (last resort)
  if (!termDatesSynced && epSettings.classOpeningDate && epSettings.classEndDate) {
    const opening = new Date(epSettings.classOpeningDate);
    const closing = new Date(epSettings.classEndDate);
    const totalMs = closing.getTime() - opening.getTime();
    const thirdMs = totalMs / 3;
    if (thirdMs > 0) {
      const t1End = new Date(opening.getTime() + thirdMs);
      const t2Start = new Date(t1End.getTime() + 1);
      const t2End = new Date(t2Start.getTime() + thirdMs);
      const t3Start = new Date(t2End.getTime() + 1);
      const settings = await prisma.systemSettings.findUnique({ where: { id: 'main' } });
      if (!settings?.t1StartDate) {
        updateData.t1StartDate = opening;
        updateData.t1EndDate = t1End;
        updateData.t2StartDate = t2Start;
        updateData.t2EndDate = t2End;
        updateData.t3StartDate = t3Start;
        updateData.t3EndDate = closing;
        updateData.termDatesDerived = true;
        logger.info(`[BrandingSync] Derived term dates from school year (approximate — no EnrollPro dates available): T1=${opening.toISOString().slice(0,10)}-${t1End.toISOString().slice(0,10)}, T2=${t2Start.toISOString().slice(0,10)}-${t2End.toISOString().slice(0,10)}, T3=${t3Start.toISOString().slice(0,10)}-${closing.toISOString().slice(0,10)}`);
      }
    }
  }
  }

  // Pull active term and school year from EnrollPro's master configuration node
  // Mandate: dependent microservices must query this on every sync/session init
  let activeSY: { id: number; yearLabel: string } | null = null;
  try {
    const activeTermData = demoMode ? null : await getIntegrationV1ActiveTerm().catch(() => null);
    if (activeTermData?.activeTerm) {
      const termUpper = activeTermData.activeTerm.toUpperCase();
      if (['T1', 'T2', 'T3'].includes(termUpper)) {
        updateData.currentTerm = termUpper;
        logger.info(`[BrandingSync] Synced active term from EnrollPro: ${termUpper} (schoolYearId=${activeTermData.schoolYearId})`);
      }
    }
    activeSY = await getIntegrationV1ActiveSchoolYear().catch(() => null);
  } catch (err: any) {
    logger.warn(`[BrandingSync] Active term/school-year sync failed (non-fatal): ${err.message}`);
  }

  // Upsert settings FIRST so new branding (schoolName, schoolHeadName) is written
  // before ensureSchoolYearFromEnrollPro creates a new year (which snapshots the settings).
  const settings = await prisma.systemSettings.upsert({
    where: { id: "main" },
    update: updateData,
    create: { id: "main", ...updateData },
  });

  // Now align SchoolYear record to EnrollPro (source of truth) — AFTER the upsert
  // so the snapshot captures the CURRENT year's branding, not the previous year's.
  // This ordering bugfix ensures W1: snapshot set once at creation, post-upsert.
  try {
    if (activeSY?.id && activeSY?.yearLabel) {
      await ensureSchoolYearFromEnrollPro(activeSY.id, activeSY.yearLabel);
    }
  } catch (err: any) {
    logger.warn(`[BrandingSync] School year alignment failed (non-fatal): ${err.message}`);
  }

  // Invalidate school year cache if the year changed
  if (epSettings.activeSchoolYearLabel) {
    invalidateSchoolYearCache();
  }

  // Keep active year's snapshot in step with new branding (W2)
  await syncActiveYearSnapshot();

  // Push to all connected SSE clients so the UI updates immediately
  broadcastSettingsUpdate(settings);

  return settings;
}

// ---------------------------------------------------------------------------
// Background scheduler
// ---------------------------------------------------------------------------

// NOTE: Scheduling is now handled by syncCoordinator.ts.
// Call syncEnrollProBranding() directly; do not add a scheduler here.
