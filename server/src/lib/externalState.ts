/**
 * externalState.ts — process-wide external-system connectivity state (P2-1).
 *
 * Tracks up/down per system with transition-only side effects:
 *  - exactly one DOWN log per outage, one UP log per recovery
 *  - recovery invokes the registered handler (scope invalidation + resync)
 *
 * No I/O. Updated by request-path outcomes and sync health checks.
 */
import { logger } from './logger';

export type ExternalSystem = 'enrollpro' | 'atlas' | 'aims';

type Status = 'up' | 'down' | 'unknown';

interface SystemState {
  status: Status;
  lastCheckAt: number;
  changedAt: number;
  lastError?: string;
}

const states = new Map<ExternalSystem, SystemState>();
let recoveryHandler: ((system: ExternalSystem) => void) | null = null;

function stateOf(system: ExternalSystem): SystemState {
  return (
    states.get(system) ?? {
      status: 'unknown',
      lastCheckAt: 0,
      changedAt: 0,
    }
  );
}

export function setExternalRecoveryHandler(handler: (system: ExternalSystem) => void): void {
  recoveryHandler = handler;
}

export function reportExternalSuccess(system: ExternalSystem): void {
  const prev = stateOf(system);
  const wasDown = prev.status === 'down';
  states.set(system, { status: 'up', lastCheckAt: Date.now(), changedAt: Date.now() });
  if (wasDown) {
    const downFor = prev.changedAt ? `${Math.round((Date.now() - prev.changedAt) / 1000)}s` : 'unknown';
    logger.info(`[ExternalState] ${system.toUpperCase()} UP after ${downFor} — recovery handler running`);
    try {
      recoveryHandler?.(system);
    } catch (err: any) {
      logger.warn(`[ExternalState] recovery handler failed for ${system}: ${err.message}`);
    }
  }
}

export function reportExternalFailure(system: ExternalSystem, error: unknown): void {
  const prev = stateOf(system);
  const message = error instanceof Error ? error.message : String(error);
  states.set(system, { status: 'down', lastCheckAt: Date.now(), changedAt: prev.status === 'down' ? prev.changedAt : Date.now(), lastError: message });
  if (prev.status !== 'down') {
    logger.warn(`[ExternalState] ${system.toUpperCase()} DOWN (${message}) — fast-fail mode active`);
  }
}

export function getExternalState(system: ExternalSystem): SystemState {
  return stateOf(system);
}

export function isExternalDown(system: ExternalSystem): boolean {
  return stateOf(system).status === 'down';
}

export function resetExternalStates(): void {
  states.clear();
}
