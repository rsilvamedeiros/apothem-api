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
