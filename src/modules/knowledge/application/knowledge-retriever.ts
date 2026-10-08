import { toSearchTerms } from '../domain/search-query.js';
import type { KnowledgeEvidence, KnowledgeSearchPort } from './knowledge.port.js';

export const MAX_EVIDENCE_PER_SEARCH = 3;

export interface RetrievalRequest {
  readonly workspaceId: string;
  /** Derived by the server from authorization or from the published agent version, never from a payload or from the model. */
  readonly knowledgeBaseIds: readonly string[];
  readonly query: string;
}

/** What the agent runtime and the API both use to read knowledge. */
export interface KnowledgeRetrieverPort {
  retrieve(request: RetrievalRequest): Promise<KnowledgeEvidence[]>;
}

/**
 * Permission-before-retrieval (ADR-014): the scope is part of the search
 * request itself, so nothing outside it is ever a candidate. A query without
 * searchable terms, or a scope without bases, retrieves nothing.
 */
export class KnowledgeRetriever implements KnowledgeRetrieverPort {
  constructor(private readonly search: KnowledgeSearchPort) {}

  async retrieve(request: RetrievalRequest): Promise<KnowledgeEvidence[]> {
    const terms = toSearchTerms(request.query);
    if (terms.length === 0 || request.knowledgeBaseIds.length === 0) {
      return [];
    }
    return this.search.search({
      workspaceId: request.workspaceId,
      knowledgeBaseIds: request.knowledgeBaseIds,
      terms,
      limit: MAX_EVIDENCE_PER_SEARCH,
    });
  }
}
