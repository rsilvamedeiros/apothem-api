import type { Chunk } from '../domain/chunker.js';
import type { KnowledgeBase, KnowledgeDocument, NewKnowledgeBase, NewKnowledgeDocument } from '../infrastructure/schema.js';

/** A document without its (potentially large) text, for listings. */
export type KnowledgeDocumentSummary = Omit<KnowledgeDocument, 'content'>;

/** Every query is scoped by workspace. */
export interface KnowledgeBasePort {
  create(input: NewKnowledgeBase): Promise<KnowledgeBase>;
  findById(workspaceId: string, knowledgeBaseId: string): Promise<KnowledgeBase | undefined>;
  findActiveByName(workspaceId: string, name: string): Promise<KnowledgeBase | undefined>;
  listByWorkspace(workspaceId: string): Promise<KnowledgeBase[]>;
  countActive(workspaceId: string): Promise<number>;
  /** Compare-and-set out of `active`; `undefined` when it was not active. */
  archive(workspaceId: string, knowledgeBaseId: string, archivedAt: Date): Promise<KnowledgeBase | undefined>;
}

export interface KnowledgeDocumentPort {
  /** Stores the document and all its chunks atomically. */
  createWithChunks(input: NewKnowledgeDocument, chunks: readonly Chunk[]): Promise<KnowledgeDocumentSummary>;
  findByChecksum(knowledgeBaseId: string, checksum: string): Promise<KnowledgeDocumentSummary | undefined>;
  findSummaryById(workspaceId: string, documentId: string): Promise<KnowledgeDocumentSummary | undefined>;
  listByBase(workspaceId: string, knowledgeBaseId: string): Promise<KnowledgeDocumentSummary[]>;
  countByBase(knowledgeBaseId: string): Promise<number>;
  /** Removes the document and its chunks. `false` when nothing matched. */
  delete(workspaceId: string, documentId: string): Promise<boolean>;
}

/** One retrieved passage with the identity of its source (ADR-014). */
export interface KnowledgeEvidence {
  readonly chunkId: string;
  readonly knowledgeBaseId: string;
  readonly documentId: string;
  readonly documentTitle: string;
  readonly ordinal: number;
  readonly section: string | null;
  readonly text: string;
  readonly score: number;
}

export interface KnowledgeSearchRequest {
  readonly workspaceId: string;
  /** Already authorized by the caller; the query is constrained to exactly these bases. */
  readonly knowledgeBaseIds: readonly string[];
  /** Plain terms from `toSearchTerms`; combined with OR. */
  readonly terms: readonly string[];
  readonly limit: number;
}

export interface KnowledgeSearchPort {
  /** Only active bases and ready documents inside the workspace and the given bases are ever candidates. */
  search(request: KnowledgeSearchRequest): Promise<KnowledgeEvidence[]>;
}
