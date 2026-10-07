import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { RUN_STATUSES, canTransition, isTerminal, type RunStatus } from './run-state.js';

const statusArb = fc.constantFrom(...RUN_STATUSES);

describe('run state machine', () => {
  it.each([
    ['queued', 'running'],
    ['queued', 'cancelled'],
    ['running', 'completed'],
    ['running', 'failed'],
    ['running', 'cancelled'],
  ] as const)('allows %s -> %s', (from, to) => {
    expect(canTransition(from, to)).toBe(true);
  });

  it.each([
    ['queued', 'completed'],
    ['queued', 'failed'],
    ['queued', 'queued'],
    ['running', 'queued'],
    ['running', 'running'],
  ] as const)('forbids skipping or repeating a step: %s -> %s', (from, to) => {
    expect(canTransition(from, to)).toBe(false);
  });

  it('treats completed, failed and cancelled as terminal', () => {
    expect(RUN_STATUSES.filter(isTerminal).sort()).toEqual(['cancelled', 'completed', 'failed']);
  });

  it('never leaves a terminal state (a finished run is never rewritten) (property)', () => {
    fc.assert(
      fc.property(statusArb, statusArb, (from, to) => {
        if (isTerminal(from)) expect(canTransition(from, to)).toBe(false);
      }),
    );
  });

  it('never moves backwards in the lifecycle (property)', () => {
    const order: Record<RunStatus, number> = { queued: 0, running: 1, completed: 2, failed: 2, cancelled: 2 };
    fc.assert(
      fc.property(statusArb, statusArb, (from, to) => {
        if (canTransition(from, to)) expect(order[to]).toBeGreaterThan(order[from]);
      }),
    );
  });

  it('rejects forged status names instead of throwing', () => {
    for (const forged of ['toString', 'constructor', '__proto__']) {
      expect(canTransition(forged as RunStatus, 'running')).toBe(false);
      expect(canTransition('queued', forged as RunStatus)).toBe(false);
      expect(isTerminal(forged as RunStatus)).toBe(false);
    }
  });

  it('lets every non-terminal state reach a terminal one', () => {
    for (const status of RUN_STATUSES.filter((s) => !isTerminal(s))) {
      expect(RUN_STATUSES.some((to) => isTerminal(to) && canTransition(status, to))).toBe(true);
    }
  });
});
