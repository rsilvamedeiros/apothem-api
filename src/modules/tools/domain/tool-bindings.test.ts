import { describe, expect, it } from 'vitest';
import { MAX_TOOL_BINDINGS, parseToolBindings } from './tool-bindings.js';

const issuesOf = (raw: unknown): string[] => {
  const result = parseToolBindings(raw);
  if (result.ok) throw new Error('expected the bindings to be rejected');
  return result.issues;
};

describe('parseToolBindings', () => {
  it('accepts an empty list', () => {
    expect(parseToolBindings([])).toEqual({ ok: true, value: [] });
  });

  it('accepts catalog tools with an approval mode', () => {
    const raw = [
      { tool: 'get_current_time', approval: 'auto' },
      { tool: 'create_note', approval: 'required' },
    ];
    expect(parseToolBindings(raw)).toEqual({ ok: true, value: raw });
  });

  it('rejects anything that is not a list', () => {
    expect(issuesOf({ tool: 'create_note', approval: 'auto' })).toEqual(['(root): invalid_type']);
    expect(issuesOf(null)).toEqual(['(root): invalid_type']);
  });

  it('rejects a tool that is not in the catalog without echoing its name', () => {
    const issues = issuesOf([{ tool: 'delete_everything', approval: 'auto' }]);
    expect(issues).toEqual(['0.tool: custom (unknown tool)']);
    expect(issues.join()).not.toContain('delete_everything');
  });

  it('rejects an unknown approval mode', () => {
    expect(issuesOf([{ tool: 'create_note', approval: 'never' }])).toEqual(['0.approval: invalid_enum_value']);
  });

  it('rejects a binding without an approval mode', () => {
    expect(issuesOf([{ tool: 'create_note' }])).toEqual(['0.approval: invalid_type']);
  });

  it('rejects unrecognized keys by name so a typo cannot change what an agent may do', () => {
    expect(issuesOf([{ tool: 'create_note', approval: 'auto', aproval: 'auto' }])).toEqual(['0: unrecognized key(s) aproval']);
  });

  it('rejects the same tool bound twice and points at the second binding', () => {
    expect(
      issuesOf([
        { tool: 'create_note', approval: 'required' },
        { tool: 'create_note', approval: 'auto' },
      ]),
    ).toEqual(['1.tool: custom (duplicate tool)']);
  });

  it('allows the maximum number of bindings and rejects one more', () => {
    expect(MAX_TOOL_BINDINGS).toBe(5);
    const names = ['get_current_time', 'create_note'];
    const fits = names.map((tool) => ({ tool, approval: 'auto' }));
    expect(parseToolBindings(fits).ok).toBe(true);
    const tooMany = Array.from({ length: MAX_TOOL_BINDINGS + 1 }, () => ({ tool: 'create_note', approval: 'auto' }));
    expect(issuesOf(tooMany).some((issue) => issue.startsWith('(root): too_big'))).toBe(true);
  });
});
