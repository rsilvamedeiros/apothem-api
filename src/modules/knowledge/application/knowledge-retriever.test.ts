import { describe, expect, it, vi } from 'vitest';
import type { KnowledgeEvidence, KnowledgeSearchPort } from './knowledge.port.js';
import { KnowledgeRetriever, MAX_EVIDENCE_PER_SEARCH } from './knowledge-retriever.js';

const BASE = '11111111-1111-4111-8111-111111111111';
const WORKSPACE = '22222222-2222-4222-8222-222222222222';

const evidence: KnowledgeEvidence = {
  chunkId: 'c1',
  knowledgeBaseId: BASE,
  documentId: 'd1',
  documentTitle: 'Doc',
  ordinal: 0,
  section: null,
  text: 'text',
  score: 1,
};

describe('KnowledgeRetriever', () => {
  const make = (results: KnowledgeEvidence[] = [evidence]) => {
    const search = vi.fn<KnowledgeSearchPort['search']>(async () => results);
    return { search, retriever: new KnowledgeRetriever({ search }) };
  };

  it('searches with the server-given scope and plain terms, capped at three passages', async () => {
    const { search, retriever } = make();
    const results = await retriever.retrieve({ workspaceId: WORKSPACE, knowledgeBaseIds: [BASE], query: "Refund! policy' | x" });
    expect(results).toEqual([evidence]);
    expect(MAX_EVIDENCE_PER_SEARCH).toBe(3);
    expect(search).toHaveBeenCalledWith({ workspaceId: WORKSPACE, knowledgeBaseIds: [BASE], terms: ['refund', 'policy'], limit: 3 });
  });

  it('retrieves nothing, and does not search, when no base is in scope', async () => {
    const { search, retriever } = make();
    expect(await retriever.retrieve({ workspaceId: WORKSPACE, knowledgeBaseIds: [], query: 'refund' })).toEqual([]);
    expect(search).not.toHaveBeenCalled();
  });

  it('retrieves nothing, and does not search, when the query has no searchable terms', async () => {
    const { search, retriever } = make();
    expect(await retriever.retrieve({ workspaceId: WORKSPACE, knowledgeBaseIds: [BASE], query: ' ?! ' })).toEqual([]);
    expect(search).not.toHaveBeenCalled();
  });
});
