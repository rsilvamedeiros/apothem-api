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
    ['running', 'waiting_approval'],
    ['waiting_approval', 'running'],
    ['waiting_approval', 'failed'],
    ['waiting_approval', 'cancelled'],
  ] as const)('allows %s -> %s', (from, to) => {
    expect(canTransition(from, to)).toBe(true);
  });

  it.each([
    ['queued', 'completed'],
    ['queued', 'failed'],
    ['queued', 'queued'],
    ['queued', 'waiting_approval'],
    ['running', 'queued'],
    ['running', 'running'],
    ['waiting_approval', 'completed'],
    ['waiting_approval', 'queued'],
    ['waiting_approval', 'waiting_approval'],
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

  it('never returns to queued, and only reaches completed through running (property)', () => {
    fc.assert(
      fc.property(statusArb, statusArb, (from, to) => {
        if (to === 'queued') expect(canTransition(from, to)).toBe(false);
        if (to === 'completed' && canTransition(from, to)) expect(from).toBe('running');
      }),
    );
  });

  it('only a human decision or a cancellation ends a waiting run, never a silent completion', () => {
    const outcomes = RUN_STATUSES.filter((status) => canTransition('waiting_approval', status)).sort();
    expect(outcomes).toEqual(['cancelled', 'failed', 'running']);
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
      const reachable = new Set<RunStatus>([status]);
      let grew = true;
      while (grew) {
        grew = false;
        for (const from of [...reachable]) {
          for (const to of RUN_STATUSES) {
            if (canTransition(from, to) && !reachable.has(to)) {
              reachable.add(to);
              grew = true;
            }
          }
        }
      }
      expect([...reachable].some(isTerminal)).toBe(true);
    }
  });
});
