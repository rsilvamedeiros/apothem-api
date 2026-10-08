import { describe, expect, it } from 'vitest';
import { MAX_KNOWLEDGE_BINDINGS, parseKnowledgeBindings } from './knowledge-bindings.js';

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';

const issuesOf = (raw: unknown): string[] => {
  const result = parseKnowledgeBindings(raw);
  if (result.ok) throw new Error('expected the bindings to be rejected');
  return result.issues;
};

describe('parseKnowledgeBindings', () => {
  it('accepts an empty list', () => {
    expect(parseKnowledgeBindings([])).toEqual({ ok: true, value: [] });
  });

  it('accepts distinct knowledge base ids', () => {
    const raw = [{ knowledgeBaseId: A }, { knowledgeBaseId: B }];
    expect(parseKnowledgeBindings(raw)).toEqual({ ok: true, value: raw });
  });

  it('rejects anything that is not a list', () => {
    expect(issuesOf({ knowledgeBaseId: A })).toEqual(['(root): invalid_type']);
    expect(issuesOf(null)).toEqual(['(root): invalid_type']);
  });

  it('rejects an id that is not a UUID without echoing it', () => {
    const issues = issuesOf([{ knowledgeBaseId: 'all-bases' }]);
    expect(issues).toEqual(['0.knowledgeBaseId: invalid_string']);
    expect(issues.join()).not.toContain('all-bases');
  });

  it('rejects a binding without an id', () => {
    expect(issuesOf([{}])).toEqual(['0.knowledgeBaseId: invalid_type']);
  });

  it('rejects unrecognized keys by name', () => {
    expect(issuesOf([{ knowledgeBaseId: A, workspaceId: B }])).toEqual(['0: unrecognized key(s) workspaceId']);
  });

  it('rejects the same base bound twice and points at the second binding', () => {
    expect(issuesOf([{ knowledgeBaseId: A }, { knowledgeBaseId: A }])).toEqual(['1.knowledgeBaseId: custom (duplicate knowledge base)']);
  });

  it('allows the maximum number of bindings and rejects one more', () => {
    expect(MAX_KNOWLEDGE_BINDINGS).toBe(5);
    const ids = Array.from({ length: MAX_KNOWLEDGE_BINDINGS + 1 }, (_, n) => ({ knowledgeBaseId: `00000000-0000-4000-8000-00000000000${n}` }));
    expect(parseKnowledgeBindings(ids.slice(0, MAX_KNOWLEDGE_BINDINGS)).ok).toBe(true);
    expect(issuesOf(ids).some((issue) => issue.startsWith('(root): too_big'))).toBe(true);
  });
});
