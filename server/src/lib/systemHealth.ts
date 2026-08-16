import { prisma } from './prisma';
import { getSyncCircuitBreakerStatus, getUnifiedSyncStatus } from './syncCoordinator';

const ENROLLPRO_BASE = (process.env.ENROLLPRO_URL ?? process.env.ENROLLPRO_BASE_URL ?? 'https://dev-jegs.buru-degree.ts.net/api').replace(/\/$/, '');
const ATLAS_BASE = (process.env.ATLAS_URL ?? process.env.ATLAS_BASE_URL ?? 'https://njgrm.buru-degree.ts.net/api/v1').replace(/\/$/, '');
const AIMS_BASE = (process.env.AIMS_URL ?? process.env.AIMS_BASE_URL ?? 'http://100.92.245.14:5000/api/v1').replace(/\/$/, '');

export interface ExternalHealthCheck {
  name: string;
  url: string;
  online: boolean;
  httpStatus: number | null;
  latencyMs: number;
  status: 'HEALTHY' | 'DEGRADED' | 'DOWN';
  error?: string;
}

function buildUrl(base: string, path: string): string {
  return `${base}${path.startsWith('/') ? path : `/${path}`}`;
}

function evaluateStatus(online: boolean, httpStatus: number | null): ExternalHealthCheck['status'] {
  if (!online) return 'DOWN';
  if (httpStatus && httpStatus >= 200 && httpStatus < 300) return 'HEALTHY';
  return 'DEGRADED';
}

async function pingUrl(name: string, url: string): Promise<ExternalHealthCheck> {
  const started = Date.now();
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(5000) });
    const status = evaluateStatus(response.ok, response.status);
    return {
      name,
      url,
      online: response.ok,
      httpStatus: response.status,
      latencyMs: Date.now() - started,
      status,
      ...(response.ok ? {} : { error: `HTTP ${response.status}` }),
    };
  } catch (error) {
    return {
      name,
      url,
      online: false,
      httpStatus: null,
      latencyMs: Date.now() - started,
      status: 'DOWN',
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

export async function getSystemHealthSnapshot() {
  const startedAt = Date.now();

  const dbStartedAt = Date.now();
  let dbOnline = false;
  let dbError: string | null = null;
  try {
    await prisma.$queryRawUnsafe('SELECT 1');
    dbOnline = true;
  } catch (error) {
    dbOnline = false;
    dbError = error instanceof Error ? error.message : 'Unknown DB error';
  }
  const dbLatencyMs = Date.now() - dbStartedAt;

  const [enrollpro, atlas, aims, recentHistory] = await Promise.all([
    pingUrl('EnrollPro', buildUrl(ENROLLPRO_BASE, '/integration/v1/health')),
    pingUrl('Atlas', buildUrl(ATLAS_BASE, '/health')),
    pingUrl('AIMS', buildUrl(AIMS_BASE, '/health')),
    prisma.syncHistory.findMany({
      take: 20,
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        source: true,
        status: true,
        durationMs: true,
        startedAt: true,
        completedAt: true,
        error: true,
        createdAt: true,
      },
    }),
  ]);

  const external = { enrollpro, atlas, aims };
  const externalAllOnline = enrollpro.online && atlas.online && aims.online;
  const overall = dbOnline && externalAllOnline ? 'HEALTHY' : 'DEGRADED';

  const memory = process.memoryUsage();

  return {
    status: overall,
    timestamp: new Date().toISOString(),
    responseTimeMs: Date.now() - startedAt,
    local: {
      uptimeSeconds: Math.floor(process.uptime()),
      memory: {
        rss: memory.rss,
        heapTotal: memory.heapTotal,
        heapUsed: memory.heapUsed,
        external: memory.external,
      },
      database: {
        online: dbOnline,
        latencyMs: dbLatencyMs,
        ...(dbError ? { error: dbError } : {}),
      },
    },
    external,
    sync: {
      coordinator: getUnifiedSyncStatus(),
      circuitBreaker: getSyncCircuitBreakerStatus(),
      recentHistory,
    },
  };
}
