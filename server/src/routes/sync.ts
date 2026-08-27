import { Router, Response } from 'express';
import { authenticateToken, authorizeRoles, AuthRequest } from '../middleware/auth';
import {
  runUnifiedSync,
  getUnifiedSyncStatus,
  isUnifiedSyncRunning,
  getLastUnifiedSyncResult,
  triggerImmediateSync,
} from '../lib/syncCoordinator';
import { runAtlasSync } from '../lib/atlasSync';
import { prisma } from '../lib/prisma';
import { logger } from '../lib/logger';

const router = Router();

function requireAdmin(req: AuthRequest, res: Response, next: () => void): void {
  if (!req.user || req.user.role !== 'ADMIN') {
    res.status(403).json({ message: 'Access denied. Admin only.' });
    return;
  }

  next();
}

// POST /api/sync/all — Full unified sync (EnrollPro → Atlas → Branding)
router.post('/all', authenticateToken, requireAdmin, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    if (isUnifiedSyncRunning()) {
      res.json({ message: 'Sync already in progress', running: true });
      return;
    }
    const result = await runUnifiedSync({ source: 'admin-manual', forceBranding: true });
    res.json({ message: 'Full sync complete', result });
  } catch (error: any) {
    logger.error("Full sync failed:", error);
    res.status(500).json({ message: 'Sync failed' });
  }
});

// GET /api/sync/status — Comprehensive sync status
router.get('/status', authenticateToken, requireAdmin, async (_req: AuthRequest, res: Response): Promise<void> => {
  try {
    const [studentCount, enrollmentCount, sectionCount, assignmentCount] = await Promise.all([
      prisma.student.count(),
      prisma.enrollment.count(),
      prisma.section.count(),
      prisma.classAssignment.count(),
    ]);

    res.json({
      syncStatus: getUnifiedSyncStatus(),
      liveCounts: { studentCount, enrollmentCount, sectionCount, assignmentCount },
      sources: {
        enrollpro: process.env.ENROLLPRO_URL || process.env.ENROLLPRO_BASE_URL || 'https://dev-jegs.buru-degree.ts.net/api',
        atlas: process.env.ATLAS_URL || process.env.ATLAS_BASE_URL || 'https://njgrm.buru-degree.ts.net/api/v1',
      },
    });
  } catch (error: any) {
    logger.error("Error fetching sync status:", error);
    res.status(500).json({ message: 'Failed to fetch status' });
  }
});

// POST /api/sync/atlas — Sync class assignments from Atlas only
router.post('/atlas', authenticateToken, requireAdmin, async (_req: AuthRequest, res: Response): Promise<void> => {
  try {
    const result = await runAtlasSync();
    res.json({ message: 'Atlas sync complete', result });
  } catch (error: any) {
    logger.error("Atlas sync failed:", error);
    res.status(500).json({ message: 'Atlas sync failed' });
  }
});

export default router;