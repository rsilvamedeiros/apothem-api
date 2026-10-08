import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import type { Database } from '../../../infrastructure/database/client.js';
import type { KnowledgeEvidence, KnowledgeSearchPort, KnowledgeSearchRequest } from '../application/knowledge.port.js';
import { knowledgeBases, knowledgeChunks, knowledgeDocuments } from './schema.js';

const PLAIN_TERM = /^[\p{L}\p{N}]+$/u;
/** Terms from this length on match by prefix, so "refund" finds "refunds" without stemming. */
const PREFIX_MATCH_FROM = 3;

/**
 * Lexical retrieval over the generated tsvector (ADR-014). The scope is part
 * of the WHERE clause, so a chunk outside the workspace, the bound bases, an
 * active base or a ready document is never a candidate, and nothing is
 * filtered after ranking.
 */
export class KnowledgeSearchRepository implements KnowledgeSearchPort {
  constructor(private readonly db: Database) {}

  async search(request: KnowledgeSearchRequest): Promise<KnowledgeEvidence[]> {
    // Defense in depth: the caller already reduced the query to plain terms.
    const terms = request.terms.filter((term) => PLAIN_TERM.test(term));
    if (terms.length === 0 || request.knowledgeBaseIds.length === 0) {
      return [];
    }

    // Terms are letters and digits only, so the operators below are the only ones in the expression.
    const expression = terms.map((term) => (Array.from(term).length >= PREFIX_MATCH_FROM ? `${term}:*` : term)).join(' | ');
    const query = sql`to_tsquery('simple', ${expression})`;
    const score = sql<number>`ts_rank_cd(${knowledgeChunks.searchVector}, ${query})`;

    const rows = await this.db
      .select({
        chunkId: knowledgeChunks.id,
        knowledgeBaseId: knowledgeChunks.knowledgeBaseId,
        documentId: knowledgeChunks.documentId,
        documentTitle: knowledgeDocuments.title,
        ordinal: knowledgeChunks.ordinal,
        section: knowledgeChunks.section,
        text: knowledgeChunks.text,
        score,
      })
      .from(knowledgeChunks)
      .innerJoin(knowledgeDocuments, eq(knowledgeChunks.documentId, knowledgeDocuments.id))
      .innerJoin(knowledgeBases, eq(knowledgeChunks.knowledgeBaseId, knowledgeBases.id))
      .where(
        and(
          eq(knowledgeChunks.workspaceId, request.workspaceId),
          inArray(knowledgeChunks.knowledgeBaseId, [...request.knowledgeBaseIds]),
          eq(knowledgeBases.workspaceId, request.workspaceId),
          eq(knowledgeBases.status, 'active'),
          eq(knowledgeDocuments.status, 'ready'),
          sql`${knowledgeChunks.searchVector} @@ ${query}`,
        ),
      )
      .orderBy(desc(score), asc(knowledgeChunks.documentId), asc(knowledgeChunks.ordinal))
      .limit(request.limit);

    return rows.map((row) => ({ ...row, score: Number(row.score) }));
  }
}
