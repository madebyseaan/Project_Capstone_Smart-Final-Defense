/**
 * external-state.test.ts — T1 unit tests for the connectivity state module (P2-1/P2-2).
 * No DB, no network.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import {
  reportExternalFailure,
  reportExternalSuccess,
  getExternalState,
  isExternalDown,
  setExternalRecoveryHandler,
  resetExternalStates,
} from '../lib/externalState';

describe('externalState', () => {
  beforeEach(() => resetExternalStates());

  it('starts unknown', () => {
    expect(getExternalState('enrollpro').status).toBe('unknown');
    expect(isExternalDown('enrollpro')).toBe(false);
  });

  it('failure marks down; repeated failures keep the original changedAt', () => {
    reportExternalFailure('enrollpro', new Error('timeout'));
    const first = getExternalState('enrollpro');
    expect(first.status).toBe('down');
    expect(isExternalDown('enrollpro')).toBe(true);

    reportExternalFailure('enrollpro', new Error('timeout again'));
    const second = getExternalState('enrollpro');
    expect(second.status).toBe('down');
    expect(second.changedAt).toBe(first.changedAt);
  });

  it('recovery fires the handler exactly once per down→up transition', () => {
    let calls: string[] = [];
    setExternalRecoveryHandler((system) => calls.push(system));

    reportExternalFailure('enrollpro', new Error('down'));
    reportExternalSuccess('enrollpro');
    expect(calls).toEqual(['enrollpro']);

    // Already up → no extra recovery event.
    reportExternalSuccess('enrollpro');
    expect(calls).toEqual(['enrollpro']);
  });

  it('failure does not fire the recovery handler', () => {
    let calls = 0;
    setExternalRecoveryHandler(() => {
      calls += 1;
    });
    reportExternalFailure('atlas', new Error('down'));
    expect(calls).toBe(0);
  });

  it('tracks systems independently', () => {
    reportExternalFailure('enrollpro', new Error('down'));
    reportExternalSuccess('atlas');
    expect(isExternalDown('enrollpro')).toBe(true);
    expect(isExternalDown('atlas')).toBe(false);
  });
});
