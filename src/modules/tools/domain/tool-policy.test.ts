import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { TOOL_RISKS, evaluateToolPolicy, type ToolRisk } from './tool-policy.js';

const riskArb = fc.constantFrom(...TOOL_RISKS);
const approvalArb = fc.constantFrom('auto', 'required');

describe('tool policy', () => {
  it('allows a read-only tool automatically', () => {
    expect(evaluateToolPolicy({ risk: 'read_only', binding: { approval: 'auto' } })).toEqual({ outcome: 'allow' });
  });

  it('can still require approval for a read-only tool when the binding asks for it', () => {
    expect(evaluateToolPolicy({ risk: 'read_only', binding: { approval: 'required' } }).outcome).toBe('require_approval');
  });

  it('requires approval for a reversible write unless the binding explicitly says auto', () => {
    expect(evaluateToolPolicy({ risk: 'reversible_write', binding: { approval: 'required' } }).outcome).toBe('require_approval');
    expect(evaluateToolPolicy({ risk: 'reversible_write', binding: { approval: 'auto' } }).outcome).toBe('allow');
  });

  it('always requires approval for an irreversible tool, whatever the binding says', () => {
    expect(evaluateToolPolicy({ risk: 'irreversible', binding: { approval: 'auto' } }).outcome).toBe('require_approval');
    expect(evaluateToolPolicy({ risk: 'irreversible', binding: { approval: 'required' } }).outcome).toBe('require_approval');
  });

  it('denies a tool that is not bound to the agent version', () => {
    for (const risk of TOOL_RISKS) {
      expect(evaluateToolPolicy({ risk, binding: undefined })).toEqual({ outcome: 'deny', reason: 'TOOL_NOT_BOUND' });
    }
  });

  it('never lets an irreversible action run without a human, for any binding (property)', () => {
    fc.assert(
      fc.property(approvalArb, (approval) => {
        expect(evaluateToolPolicy({ risk: 'irreversible', binding: { approval } }).outcome).not.toBe('allow');
      }),
    );
  });

  it('only allows automatically what is read-only or explicitly auto (property)', () => {
    fc.assert(
      fc.property(riskArb, approvalArb, (risk, approval) => {
        const { outcome } = evaluateToolPolicy({ risk, binding: { approval } });
        if (outcome === 'allow') {
          expect(risk !== 'irreversible' && (approval === 'auto' || false)).toBe(true);
        }
      }),
    );
  });

  it('fails closed for an unknown risk level or binding mode', () => {
    expect(evaluateToolPolicy({ risk: 'weird' as ToolRisk, binding: { approval: 'auto' } }).outcome).toBe('require_approval');
    expect(evaluateToolPolicy({ risk: 'read_only', binding: { approval: 'sometimes' as never } }).outcome).toBe('require_approval');
  });
});

describe('workspace tool rules (ADR-015)', () => {
  const bound = { approval: 'auto' } as const;

  it('blocks a bound tool whatever its risk or binding', () => {
    for (const risk of TOOL_RISKS) {
      for (const approval of ['auto', 'required'] as const) {
        expect(evaluateToolPolicy({ risk, binding: { approval }, workspaceRule: 'blocked' })).toEqual({
          outcome: 'deny',
          reason: 'TOOL_BLOCKED_BY_POLICY',
        });
      }
    }
  });

  it('reports an unbound tool as not bound, even when it is also blocked', () => {
    expect(evaluateToolPolicy({ risk: 'read_only', binding: undefined, workspaceRule: 'blocked' })).toEqual({
      outcome: 'deny',
      reason: 'TOOL_NOT_BOUND',
    });
  });

  it('makes a tool ask first when the workspace says so, even a read-only one the binding sets to auto', () => {
    for (const risk of TOOL_RISKS) {
      expect(evaluateToolPolicy({ risk, binding: bound, workspaceRule: 'approval_required' }).outcome).toBe('require_approval');
    }
  });

  it('leaves the decision untouched when there is no rule', () => {
    expect(evaluateToolPolicy({ risk: 'read_only', binding: bound, workspaceRule: undefined })).toEqual({ outcome: 'allow' });
    expect(evaluateToolPolicy({ risk: 'read_only', binding: bound })).toEqual({ outcome: 'allow' });
  });

  it('fails closed for a rule it does not know', () => {
    expect(evaluateToolPolicy({ risk: 'read_only', binding: bound, workspaceRule: 'allow_everything' as never })).toEqual({
      outcome: 'deny',
      reason: 'TOOL_BLOCKED_BY_POLICY',
    });
  });

  it('never makes a decision more permissive than without the rule (property)', () => {
    const strictness = { allow: 0, require_approval: 1, deny: 2 } as const;
    fc.assert(
      fc.property(
        riskArb,
        fc.option(approvalArb, { nil: undefined }),
        fc.option(fc.constantFrom('blocked', 'approval_required'), { nil: undefined }),
        (risk, approval, workspaceRule) => {
          const binding = approval ? { approval } : undefined;
          const without = evaluateToolPolicy({ risk, binding });
          const withRule = evaluateToolPolicy({ risk, binding, workspaceRule });
          expect(strictness[withRule.outcome]).toBeGreaterThanOrEqual(strictness[without.outcome]);
        },
      ),
    );
  });

  it('never lets a blocked tool through for any input (property)', () => {
    fc.assert(
      fc.property(riskArb, approvalArb, (risk, approval) => {
        expect(evaluateToolPolicy({ risk, binding: { approval }, workspaceRule: 'blocked' }).outcome).toBe('deny');
      }),
    );
  });
});