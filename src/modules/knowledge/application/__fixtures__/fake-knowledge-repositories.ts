import type { Chunk } from '../../domain/chunker.js';
import type {
  KnowledgeBasePort,
  KnowledgeDocumentPort,
  KnowledgeDocumentSummary,
  KnowledgeEvidence,
  KnowledgeSearchPort,
  KnowledgeSearchRequest,
} from '../knowledge.port.js';
import type { KnowledgeBase, KnowledgeDocument, NewKnowledgeBase, NewKnowledgeDocument } from '../../infrastructure/schema.js';

export class FakeKnowledgeBaseRepository implements KnowledgeBasePort {
  readonly rows: KnowledgeBase[] = [];
  private lastTimestamp = 0;

  async create(input: NewKnowledgeBase): Promise<KnowledgeBase> {
    if (this.rows.some((b) => b.workspaceId === input.workspaceId && b.name === input.name && b.status === 'active')) {
      throw new Error('duplicate key value violates unique constraint "knowledge_bases_workspace_name_uq"');
    }
    this.lastTimestamp = Math.max(Date.now(), this.lastTimestamp + 1);
    const row: KnowledgeBase = {
      id: input.id ?? crypto.randomUUID(),
      organizationId: input.organizationId,
      workspaceId: input.workspaceId,
      name: input.name,
      description: input.description ?? null,
      status: input.status ?? 'active',
      createdByPrincipalId: input.createdByPrincipalId,
      createdAt: new Date(this.lastTimestamp),
      archivedAt: null,
    };
    this.rows.push(row);
    return { ...row };
  }

  async findById(workspaceId: string, knowledgeBaseId: string): Promise<KnowledgeBase | undefined> {
    const row = this.rows.find((b) => b.workspaceId === workspaceId && b.id === knowledgeBaseId);
    return row ? { ...row } : undefined;
  }

  async findActiveByName(workspaceId: string, name: string): Promise<KnowledgeBase | undefined> {
    const row = this.rows.find((b) => b.workspaceId === workspaceId && b.name === name && b.status === 'active');
    return row ? { ...row } : undefined;
  }

  async listByWorkspace(workspaceId: string): Promise<KnowledgeBase[]> {
    return this.rows.filter((b) => b.workspaceId === workspaceId).map((b) => ({ ...b }));
  }

  async countActive(workspaceId: string): Promise<number> {
    return this.rows.filter((b) => b.workspaceId === workspaceId && b.status === 'active').length;
  }

  async archive(workspaceId: string, knowledgeBaseId: string, archivedAt: Date): Promise<KnowledgeBase | undefined> {
    const row = this.rows.find((b) => b.workspaceId === workspaceId && b.id === knowledgeBaseId && b.status === 'active');
    if (!row) return undefined;
    Object.assign(row, { status: 'archived', archivedAt });
    return { ...row };
  }
}

export interface StoredChunk extends Chunk {
  readonly id: string;
  readonly workspaceId: string;
  readonly knowledgeBaseId: string;
  readonly documentId: string;
}

function summaryOf(document: KnowledgeDocument): KnowledgeDocumentSummary {
  const { content: _content, ...summary } = document;
  return summary;
}

export class FakeKnowledgeDocumentRepository implements KnowledgeDocumentPort {
  readonly rows: KnowledgeDocument[] = [];
  readonly chunks: StoredChunk[] = [];
  private lastTimestamp = 0;

  async createWithChunks(input: NewKnowledgeDocument, chunks: readonly Chunk[]): Promise<KnowledgeDocumentSummary> {
    if (this.rows.some((d) => d.knowledgeBaseId === input.knowledgeBaseId && d.checksum === input.checksum)) {
      throw new Error('duplicate key value violates unique constraint "knowledge_documents_base_checksum_uq"');
    }
    this.lastTimestamp = Math.max(Date.now(), this.lastTimestamp + 1);
    const row: KnowledgeDocument = {
      id: input.id ?? crypto.randomUUID(),
      organizationId: input.organizationId,
      workspaceId: input.workspaceId,
      knowledgeBaseId: input.knowledgeBaseId,
      title: input.title,
      content: input.content,
      checksum: input.checksum,
      contentLength: input.contentLength,
      chunkCount: input.chunkCount,
      chunkerVersion: input.chunkerVersion,
      status: input.status ?? 'ready',
      createdByPrincipalId: input.createdByPrincipalId,
      createdAt: new Date(this.lastTimestamp),
    };
    this.rows.push(row);
    for (const chunk of chunks) {
      this.chunks.push({ ...chunk, id: crypto.randomUUID(), workspaceId: row.workspaceId, knowledgeBaseId: row.knowledgeBaseId, documentId: row.id });
    }
    return summaryOf(row);
  }

  async findByChecksum(knowledgeBaseId: string, checksum: string): Promise<KnowledgeDocumentSummary | undefined> {
    const row = this.rows.find((d) => d.knowledgeBaseId === knowledgeBaseId && d.checksum === checksum);
    return row ? summaryOf(row) : undefined;
  }

  async findSummaryById(workspaceId: string, documentId: string): Promise<KnowledgeDocumentSummary | undefined> {
    const row = this.rows.find((d) => d.workspaceId === workspaceId && d.id === documentId);
    return row ? summaryOf(row) : undefined;
  }

  async listByBase(workspaceId: string, knowledgeBaseId: string): Promise<KnowledgeDocumentSummary[]> {
    return this.rows
      .filter((d) => d.workspaceId === workspaceId && d.knowledgeBaseId === knowledgeBaseId)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .map(summaryOf);
  }

  async countByBase(knowledgeBaseId: string): Promise<number> {
    return this.rows.filter((d) => d.knowledgeBaseId === knowledgeBaseId).length;
  }

  async delete(workspaceId: string, documentId: string): Promise<boolean> {
    const index = this.rows.findIndex((d) => d.workspaceId === workspaceId && d.id === documentId);
    if (index === -1) return false;
    this.rows.splice(index, 1);
    for (let n = this.chunks.length - 1; n >= 0; n -= 1) {
      if (this.chunks[n]!.documentId === documentId) this.chunks.splice(n, 1);
    }
    return true;
  }
}

/**
 * Same scoping rules as the SQL query: workspace, bound bases, active base,
 * ready document; terms match by equality (short) or prefix, best match first.
 */
export class FakeKnowledgeSearch implements KnowledgeSearchPort {
  constructor(
    private readonly bases: FakeKnowledgeBaseRepository,
    private readonly documents: FakeKnowledgeDocumentRepository,
  ) {}

  readonly requests: KnowledgeSearchRequest[] = [];

  async search(request: KnowledgeSearchRequest): Promise<KnowledgeEvidence[]> {
    this.requests.push(request);
    const evidence: KnowledgeEvidence[] = [];
    for (const chunk of this.documents.chunks) {
      const base = this.bases.rows.find((b) => b.id === chunk.knowledgeBaseId);
      const document = this.documents.rows.find((d) => d.id === chunk.documentId);
      if (
        chunk.workspaceId !== request.workspaceId ||
        !request.knowledgeBaseIds.includes(chunk.knowledgeBaseId) ||
        base?.workspaceId !== request.workspaceId ||
        base.status !== 'active' ||
        document?.status !== 'ready'
      ) {
        continue;
      }
      const tokens = chunk.text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
      const matched = request.terms.filter((term) =>
        tokens.some((token) => (Array.from(term).length >= 3 ? token.startsWith(term) : token === term)),
      );
      if (matched.length === 0) continue;
      evidence.push({
        chunkId: chunk.id,
        knowledgeBaseId: chunk.knowledgeBaseId,
        documentId: chunk.documentId,
        documentTitle: document.title,
        ordinal: chunk.ordinal,
        section: chunk.section,
        text: chunk.text,
        score: matched.length / request.terms.length,
      });
    }
    return evidence
      .sort((a, b) => b.score - a.score || a.documentId.localeCompare(b.documentId) || a.ordinal - b.ordinal)
      .slice(0, request.limit);
  }
}
