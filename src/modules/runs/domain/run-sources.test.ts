import { describe, expect, it } from 'vitest';
import { extractSources } from './run-sources.js';

const EVIDENCE_ID = '11111111-1111-4111-8111-111111111111';

const step = (sequence: number, detail: unknown, overrides: Record<string, unknown> = {}) => ({
  sequence,
  type: 'tool_call',
  status: 'completed',
  detail,
  ...overrides,
});

const search = (results: unknown[]) => ({ tool: 'search_knowledge', outcome: 'executed', arguments: { query: 'secret question' }, result: { results } });

describe('extractSources', () => {
  it('lists each passage a search returned, with the step it came from', () => {
    const sources = extractSources([
      step(2, search([{ evidenceId: EVIDENCE_ID, title: 'Refund policy', section: 'Refunds', ordinal: 2, text: 'private passage text' }])),
    ]);
    expect(sources).toEqual([{ stepSequence: 2, evidenceId: EVIDENCE_ID, title: 'Refund policy', section: 'Refunds', ordinal: 2 }]);
  });

  it('never carries the passage text or the query', () => {
    const [source] = extractSources([step(2, search([{ evidenceId: EVIDENCE_ID, title: 'T', section: null, ordinal: 0, text: 'private passage text' }]))]);
    expect(JSON.stringify(source)).not.toContain('private passage text');
    expect(JSON.stringify(source)).not.toContain('secret question');
  });

  it('keeps a missing section as null and lists several searches in step order', () => {
    const second = { evidenceId: '22222222-2222-4222-8222-222222222222', title: 'Shipping', section: null, ordinal: 0, text: 'x' };
    const sources = extractSources([step(2, search([{ evidenceId: EVIDENCE_ID, title: 'A', section: 'S', ordinal: 1, text: 'x' }])), step(5, search([second]))]);
    expect(sources.map((s) => [s.stepSequence, s.title, s.section])).toEqual([
      [2, 'A', 'S'],
      [5, 'Shipping', null],
    ]);
  });

  it('ignores other tools, other step types and steps that did not complete', () => {
    expect(extractSources([step(1, { tool: 'create_note', outcome: 'executed', result: { results: [{ evidenceId: EVIDENCE_ID, title: 'T', ordinal: 0 }] } })])).toEqual([]);
    expect(extractSources([step(1, search([{ evidenceId: EVIDENCE_ID, title: 'T', section: null, ordinal: 0 }]), { type: 'model_call' })])).toEqual([]);
    expect(extractSources([step(1, search([{ evidenceId: EVIDENCE_ID, title: 'T', section: null, ordinal: 0 }]), { status: 'failed' })])).toEqual([]);
    expect(extractSources([step(1, { tool: 'search_knowledge', outcome: 'pending_approval' })])).toEqual([]);
  });

  it('tolerates any malformed detail without throwing', () => {
    const odd: unknown[] = [null, undefined, 5, 'x', [], {}, { tool: 'search_knowledge' }, { tool: 'search_knowledge', outcome: 'executed', result: null }, { tool: 'search_knowledge', outcome: 'executed', result: { results: 'no' } }];
    expect(extractSources(odd.map((detail, index) => step(index, detail)))).toEqual([]);
  });

  it('skips a passage that is malformed instead of guessing, and keeps the good ones', () => {
    const sources = extractSources([
      step(2, search([null, 5, {}, { evidenceId: 5, title: 'T', ordinal: 0 }, { evidenceId: 'not-a-uuid', title: 'T', ordinal: 0 }, { evidenceId: EVIDENCE_ID, title: 7, ordinal: 0 }, { evidenceId: EVIDENCE_ID, title: 'T', ordinal: -1 }, { evidenceId: EVIDENCE_ID, title: 'Good', section: 3, ordinal: 4 }])),
    ]);
    expect(sources).toEqual([{ stepSequence: 2, evidenceId: EVIDENCE_ID, title: 'Good', section: null, ordinal: 4 }]);
  });

  it('returns nothing for no steps', () => {
    expect(extractSources([])).toEqual([]);
  });
});
