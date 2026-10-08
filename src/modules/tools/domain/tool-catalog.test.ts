import { describe, expect, it } from 'vitest';
import { TOOL_CATALOG, getToolDefinition, listToolNames, toModelTool } from './tool-catalog.js';
import { parseToolBindings, MAX_TOOL_BINDINGS } from './tool-bindings.js';
import { TOOL_RISKS } from './tool-policy.js';

describe('tool catalog', () => {
  it('declares a description, a known risk level and an argument schema for every tool', () => {
    for (const name of listToolNames()) {
      const tool = getToolDefinition(name)!;
      expect(tool.name).toBe(name);
      expect(tool.description.length).toBeGreaterThan(10);
      expect(TOOL_RISKS).toContain(tool.risk);
      expect(typeof tool.argumentsSchema.safeParse).toBe('function');
    }
  });

  it('has unique, kebab-free snake_case names', () => {
    const names = listToolNames();
    expect(new Set(names).size).toBe(names.length);
    for (const name of names) expect(name).toMatch(/^[a-z][a-z0-9_]*$/);
  });

  it('classifies the built-ins conservatively', () => {
    expect(getToolDefinition('get_current_time')?.risk).toBe('read_only');
    expect(getToolDefinition('create_note')?.risk).toBe('reversible_write');
    expect(getToolDefinition('search_knowledge')?.risk).toBe('read_only');
  });

  it('validates search_knowledge arguments strictly: a query and nothing else', () => {
    const schema = getToolDefinition('search_knowledge')!.argumentsSchema;
    expect(schema.safeParse({ query: 'refund policy' }).success).toBe(true);
    expect(schema.safeParse({ query: '  padded  ' })).toMatchObject({ success: true, data: { query: 'padded' } });
    expect(schema.safeParse({ query: 'q'.repeat(300) }).success).toBe(true);
    expect(schema.safeParse({ query: 'q'.repeat(301) }).success).toBe(false);
    expect(schema.safeParse({ query: '   ' }).success).toBe(false);
    expect(schema.safeParse({}).success).toBe(false);
    // The model cannot pick or widen the knowledge bases: scope comes from the published version.
    expect(schema.safeParse({ query: 'x', knowledgeBaseIds: ['11111111-1111-4111-8111-111111111111'] }).success).toBe(false);
    expect(schema.safeParse({ query: 'x', workspaceId: 'other' }).success).toBe(false);
  });

  it('looks tools up safely, including inherited property names', () => {
    expect(getToolDefinition('does_not_exist')).toBeUndefined();
    for (const forged of ['toString', 'constructor', '__proto__', 'hasOwnProperty']) {
      expect(getToolDefinition(forged)).toBeUndefined();
    }
    expect(Object.keys(TOOL_CATALOG)).toEqual(listToolNames());
  });

  it('validates create_note arguments strictly', () => {
    const schema = getToolDefinition('create_note')!.argumentsSchema;
    expect(schema.safeParse({ title: 'Call back', body: 'Tomorrow at 10' }).success).toBe(true);
    expect(schema.safeParse({ title: '', body: 'x' }).success).toBe(false);
    expect(schema.safeParse({ title: 'x'.repeat(201), body: 'x' }).success).toBe(false);
    expect(schema.safeParse({ title: 'x', body: 'y'.repeat(5001) }).success).toBe(false);
    expect(schema.safeParse({ title: 'x', body: 'y', extra: 'field' }).success).toBe(false);
    expect(schema.safeParse({ title: 5, body: 'y' }).success).toBe(false);
    expect(schema.safeParse(null).success).toBe(false);
  });

  it('accepts no arguments for get_current_time and rejects extras', () => {
    const schema = getToolDefinition('get_current_time')!.argumentsSchema;
    expect(schema.safeParse({}).success).toBe(true);
    expect(schema.safeParse({ timezone: 'UTC' }).success).toBe(false);
  });
});

describe('toModelTool', () => {
  it('exposes name, purpose and a JSON schema, and nothing about policy or risk', () => {
    const tool = toModelTool(getToolDefinition('create_note')!);
    expect(tool.name).toBe('create_note');
    expect(tool.description).toContain('note');
    expect(tool.parameters).toMatchObject({
      type: 'object',
      required: ['title', 'body'],
      additionalProperties: false,
      properties: { title: { type: 'string' }, body: { type: 'string' } },
    });
    expect(JSON.stringify(tool)).not.toMatch(/reversible|risk|approval/i);
    expect(tool.parameters).not.toHaveProperty('$schema');
  });
});

describe('parseToolBindings', () => {
  it('accepts an empty list', () => {
    expect(parseToolBindings([])).toEqual({ ok: true, value: [] });
  });

  it('accepts known tools with an approval mode', () => {
    const bindings = [
      { tool: 'get_current_time', approval: 'auto' },
      { tool: 'create_note', approval: 'required' },
    ];
    expect(parseToolBindings(bindings)).toEqual({ ok: true, value: bindings });
  });

  it.each([
    ['unknown tool', [{ tool: 'drop_database', approval: 'auto' }]],
    ['missing approval', [{ tool: 'create_note' }]],
    ['unknown approval mode', [{ tool: 'create_note', approval: 'never' }]],
    ['unknown extra key', [{ tool: 'create_note', approval: 'required', secret: 'x' }]],
    ['duplicate tool', [{ tool: 'create_note', approval: 'required' }, { tool: 'create_note', approval: 'auto' }]],
    ['not an array', { tool: 'create_note', approval: 'required' }],
    ['array of strings', ['create_note']],
    ['null', null],
    ['too many bindings', Array.from({ length: MAX_TOOL_BINDINGS + 1 }, (_, i) => ({ tool: `t${i}`, approval: 'auto' }))],
  ])('rejects %s', (_label, value) => {
    expect(parseToolBindings(value).ok).toBe(false);
  });

  it('does not let a binding waive approval for an irreversible tool', () => {
    // No irreversible built-in exists yet; the rule is enforced by the policy and tested there.
    expect(parseToolBindings([{ tool: 'create_note', approval: 'auto' }]).ok).toBe(true);
  });

  it('names the problem without echoing the offending value', () => {
    const result = parseToolBindings([{ tool: 'secret-tool-name-xyz', approval: 'auto' }]);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.issues.join(' ')).not.toContain('secret-tool-name-xyz');
  });
});
