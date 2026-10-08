import { and, count, desc, eq, getTableColumns } from 'drizzle-orm';
import type { Database } from '../../../infrastructure/database/client.js';
import type { Chunk } from '../domain/chunker.js';
import type { KnowledgeDocumentPort, KnowledgeDocumentSummary } from '../application/knowledge.port.js';
import { knowledgeChunks, knowledgeDocuments, type NewKnowledgeDocument } from './schema.js';

const { content: _content, ...summaryColumns } = getTableColumns(knowledgeDocuments);

export class KnowledgeDocumentRepository implements KnowledgeDocumentPort {
  constructor(private readonly db: Database) {}

  async createWithChunks(input: NewKnowledgeDocument, chunks: readonly Chunk[]): Promise<KnowledgeDocumentSummary> {
    return this.db.transaction(async (tx) => {
      const [document] = await tx.insert(knowledgeDocuments).values(input).returning(summaryColumns);
      if (!document) {
        throw new Error('Failed to create knowledge document');
      }
      if (chunks.length > 0) {
        await tx.insert(knowledgeChunks).values(
          chunks.map((chunk) => ({
            organizationId: document.organizationId,
            workspaceId: document.workspaceId,
            knowledgeBaseId: document.knowledgeBaseId,
            documentId: document.id,
            ordinal: chunk.ordinal,
            text: chunk.text,
            section: chunk.section,
          })),
        );
      }
      return document;
    });
  }

  async findByChecksum(knowledgeBaseId: string, checksum: string): Promise<KnowledgeDocumentSummary | undefined> {
    const [row] = await this.db
      .select(summaryColumns)
      .from(knowledgeDocuments)
      .where(and(eq(knowledgeDocuments.knowledgeBaseId, knowledgeBaseId), eq(knowledgeDocuments.checksum, checksum)))
      .limit(1);
    return row;
  }

  async findSummaryById(workspaceId: string, documentId: string): Promise<KnowledgeDocumentSummary | undefined> {
    const [row] = await this.db
      .select(summaryColumns)
      .from(knowledgeDocuments)
      .where(and(eq(knowledgeDocuments.workspaceId, workspaceId), eq(knowledgeDocuments.id, documentId)))
      .limit(1);
    return row;
  }

  async listByBase(workspaceId: string, knowledgeBaseId: string): Promise<KnowledgeDocumentSummary[]> {
    return this.db
      .select(summaryColumns)
      .from(knowledgeDocuments)
      .where(and(eq(knowledgeDocuments.workspaceId, workspaceId), eq(knowledgeDocuments.knowledgeBaseId, knowledgeBaseId)))
      .orderBy(desc(knowledgeDocuments.createdAt), desc(knowledgeDocuments.id));
  }

  async countByBase(knowledgeBaseId: string): Promise<number> {
    const [row] = await this.db
      .select({ total: count() })
      .from(knowledgeDocuments)
      .where(eq(knowledgeDocuments.knowledgeBaseId, knowledgeBaseId));
    return row?.total ?? 0;
  }

  async delete(workspaceId: string, documentId: string): Promise<boolean> {
    const rows = await this.db
      .delete(knowledgeDocuments)
      .where(and(eq(knowledgeDocuments.workspaceId, workspaceId), eq(knowledgeDocuments.id, documentId)))
      .returning({ id: knowledgeDocuments.id });
    return rows.length > 0;
  }
}
