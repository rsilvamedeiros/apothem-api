import { createHash } from 'node:crypto';
import type { AuthorizationService } from '../../authorization/application/authorization.service.js';
import type { TenantContext } from '../../authorization/application/tenant-context.js';
import type { AuditPort } from '../../audit/application/audit.port.js';
import { ConflictError, ForbiddenError, InvalidInputError, NotFoundError } from '../../../common/errors.js';
import { CHUNKER_VERSION, chunkText, normalizeText } from '../domain/chunker.js';
import { toSearchTerms } from '../domain/search-query.js';
import type { KnowledgeBase } from '../infrastructure/schema.js';
import type { KnowledgeBasePort, KnowledgeDocumentPort, KnowledgeDocumentSummary, KnowledgeEvidence } from './knowledge.port.js';
import type { KnowledgeRetrieverPort } from './knowledge-retriever.js';

export const MAX_KNOWLEDGE_BASES_PER_WORKSPACE = 20;
export const MAX_DOCUMENTS_PER_BASE = 100;
export const MAX_DOCUMENT_CONTENT_LENGTH = 100_000;
/** Refuses absurd payloads before spending any time normalizing them. */
export const MAX_RAW_CONTENT_LENGTH = MAX_DOCUMENT_CONTENT_LENGTH * 2;
export const MAX_CHUNKS_PER_DOCUMENT = 500;
export const MAX_BASE_NAME_LENGTH = 100;
export const MAX_BASE_DESCRIPTION_LENGTH = 500;
export const MAX_DOCUMENT_TITLE_LENGTH = 200;
export const MAX_SEARCH_QUERY_LENGTH = 500;

export interface CreateKnowledgeBaseInput {
  name: string;
  description?: string | undefined;
}

export interface AddDocumentInput {
  title: string;
  content: string;
}

export interface AddDocumentResult {
  document: KnowledgeDocumentSummary;
  /** True when the same content was already in the base and nothing new was stored. */
  replayed: boolean;
}

function requireWorkspaceScope(context: TenantContext): string {
  if (!context.workspaceId) {
    throw new ForbiddenError('Knowledge requires a resolved workspace scope');
  }
  return context.workspaceId;
}

/** A title is one line of plain text. */
function normalizeTitle(raw: string): string {
  return normalizeText(raw).replace(/\s+/g, ' ');
}

/**
 * Knowledge bases and their documents (ADR-014). The workspace always comes
 * from the authenticated context, every read and write is scoped by it, and
 * audit events carry ids, checksums and sizes only: never text or queries.
 */
export class KnowledgeService {
  constructor(
    private readonly bases: KnowledgeBasePort,
    private readonly documents: KnowledgeDocumentPort,
    private readonly retriever: KnowledgeRetrieverPort,
    private readonly authorization: AuthorizationService,
    private readonly audit: AuditPort,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async createBase(context: TenantContext, input: CreateKnowledgeBaseInput): Promise<KnowledgeBase> {
    this.authorization.assert(context, 'knowledge.manage');
    const workspaceId = requireWorkspaceScope(context);

    const name = normalizeTitle(input.name);
    if (name.length === 0 || name.length > MAX_BASE_NAME_LENGTH) {
      throw new InvalidInputError(`Knowledge base name must be between 1 and ${MAX_BASE_NAME_LENGTH} characters`);
    }
    const description = input.description === undefined ? undefined : normalizeText(input.description);
    if (description !== undefined && description.length > MAX_BASE_DESCRIPTION_LENGTH) {
      throw new InvalidInputError(`Knowledge base description must be at most ${MAX_BASE_DESCRIPTION_LENGTH} characters`);
    }

    if (await this.bases.findActiveByName(workspaceId, name)) {
      throw new ConflictError('A knowledge base with this name already exists in the workspace');
    }
    if ((await this.bases.countActive(workspaceId)) >= MAX_KNOWLEDGE_BASES_PER_WORKSPACE) {
      throw new ConflictError(`A workspace can have at most ${MAX_KNOWLEDGE_BASES_PER_WORKSPACE} active knowledge bases`);
    }

    let base: KnowledgeBase;
    try {
      base = await this.bases.create({
        organizationId: context.organizationId,
        workspaceId,
        name,
        description: description || null,
        createdByPrincipalId: context.principal.id,
      });
    } catch (error) {
      // Two identical requests can pass the lookup together; the unique index lets one win.
      if (await this.bases.findActiveByName(workspaceId, name)) {
        throw new ConflictError('A knowledge base with this name already exists in the workspace');
      }
      throw error;
    }

    await this.recordAudit(context, 'knowledge_base.created', 'knowledge_base', base.id, {});
    return base;
  }

  async listBases(context: TenantContext): Promise<KnowledgeBase[]> {
    this.authorization.assert(context, 'knowledge.use');
    return this.bases.listByWorkspace(requireWorkspaceScope(context));
  }

  async getBase(context: TenantContext, knowledgeBaseId: string): Promise<KnowledgeBase> {
    this.authorization.assert(context, 'knowledge.use');
    return this.requireBase(requireWorkspaceScope(context), knowledgeBaseId);
  }

  async archiveBase(context: TenantContext, knowledgeBaseId: string): Promise<KnowledgeBase> {
    this.authorization.assert(context, 'knowledge.manage');
    const workspaceId = requireWorkspaceScope(context);
    await this.requireBase(workspaceId, knowledgeBaseId);

    const archived = await this.bases.archive(workspaceId, knowledgeBaseId, this.now());
    if (!archived) {
      throw new ConflictError('Knowledge base is already archived');
    }
    await this.recordAudit(context, 'knowledge_base.archived', 'knowledge_base', archived.id, {});
    return archived;
  }

  async addDocument(context: TenantContext, knowledgeBaseId: string, input: AddDocumentInput): Promise<AddDocumentResult> {
    this.authorization.assert(context, 'knowledge.manage');
    const workspaceId = requireWorkspaceScope(context);
    const base = await this.requireBase(workspaceId, knowledgeBaseId);
    if (base.status !== 'active') {
      throw new ConflictError('Knowledge base is archived');
    }

    const title = normalizeTitle(input.title);
    if (title.length === 0 || title.length > MAX_DOCUMENT_TITLE_LENGTH) {
      throw new InvalidInputError(`Document title must be between 1 and ${MAX_DOCUMENT_TITLE_LENGTH} characters`);
    }
    if (input.content.length > MAX_RAW_CONTENT_LENGTH) {
      throw new InvalidInputError(`Document content must be between 1 and ${MAX_DOCUMENT_CONTENT_LENGTH} characters`);
    }
    const content = normalizeText(input.content);
    if (content.length === 0 || content.length > MAX_DOCUMENT_CONTENT_LENGTH) {
      throw new InvalidInputError(`Document content must be between 1 and ${MAX_DOCUMENT_CONTENT_LENGTH} characters`);
    }
    const chunks = chunkText(content);
    if (chunks.length > MAX_CHUNKS_PER_DOCUMENT) {
      throw new InvalidInputError(`Document is too fragmented: it would produce more than ${MAX_CHUNKS_PER_DOCUMENT} passages`);
    }

    const checksum = createHash('sha256').update(content).digest('hex');
    const existing = await this.documents.findByChecksum(base.id, checksum);
    if (existing) {
      return { document: existing, replayed: true };
    }
    if ((await this.documents.countByBase(base.id)) >= MAX_DOCUMENTS_PER_BASE) {
      throw new ConflictError(`A knowledge base can hold at most ${MAX_DOCUMENTS_PER_BASE} documents`);
    }

    let document: KnowledgeDocumentSummary;
    try {
      document = await this.documents.createWithChunks(
        {
          organizationId: context.organizationId,
          workspaceId,
          knowledgeBaseId: base.id,
          title,
          content,
          checksum,
          contentLength: content.length,
          chunkCount: chunks.length,
          chunkerVersion: CHUNKER_VERSION,
          createdByPrincipalId: context.principal.id,
        },
        chunks,
      );
    } catch (error) {
      // The same content added twice at once: the unique index lets one win and the other replays it.
      const winner = await this.documents.findByChecksum(base.id, checksum);
      if (winner) {
        return { document: winner, replayed: true };
      }
      throw error;
    }

    await this.recordAudit(context, 'knowledge_document.added', 'knowledge_document', document.id, {
      knowledgeBaseId: base.id,
      checksum,
      contentLength: document.contentLength,
      chunkCount: document.chunkCount,
    });
    return { document, replayed: false };
  }

  async listDocuments(context: TenantContext, knowledgeBaseId: string): Promise<KnowledgeDocumentSummary[]> {
    this.authorization.assert(context, 'knowledge.use');
    const workspaceId = requireWorkspaceScope(context);
    await this.requireBase(workspaceId, knowledgeBaseId);
    return this.documents.listByBase(workspaceId, knowledgeBaseId);
  }

  async removeDocument(context: TenantContext, knowledgeBaseId: string, documentId: string): Promise<void> {
    this.authorization.assert(context, 'knowledge.manage');
    const workspaceId = requireWorkspaceScope(context);
    await this.requireBase(workspaceId, knowledgeBaseId);

    const document = await this.documents.findSummaryById(workspaceId, documentId);
    // A document of another base is indistinguishable from a missing one.
    if (!document || document.knowledgeBaseId !== knowledgeBaseId) {
      throw new NotFoundError(`Document ${documentId} not found`);
    }
    if (!(await this.documents.delete(workspaceId, documentId))) {
      throw new NotFoundError(`Document ${documentId} not found`);
    }
    await this.recordAudit(context, 'knowledge_document.removed', 'knowledge_document', documentId, {
      knowledgeBaseId,
      checksum: document.checksum,
    });
  }

  /** Lets a person see what an agent bound to this base would be given for a query. */
  async search(context: TenantContext, knowledgeBaseId: string, query: string): Promise<KnowledgeEvidence[]> {
    this.authorization.assert(context, 'knowledge.use');
    const workspaceId = requireWorkspaceScope(context);
    const base = await this.requireBase(workspaceId, knowledgeBaseId);
    if (base.status !== 'active') {
      throw new ConflictError('Knowledge base is archived');
    }

    const text = query.trim();
    if (text.length === 0 || text.length > MAX_SEARCH_QUERY_LENGTH) {
      throw new InvalidInputError(`Search query must be between 1 and ${MAX_SEARCH_QUERY_LENGTH} characters`);
    }
    if (toSearchTerms(text).length === 0) {
      throw new InvalidInputError('Search query has no searchable terms');
    }
    return this.retriever.retrieve({ workspaceId, knowledgeBaseIds: [base.id], query: text });
  }

  private async requireBase(workspaceId: string, knowledgeBaseId: string): Promise<KnowledgeBase> {
    const base = await this.bases.findById(workspaceId, knowledgeBaseId);
    if (!base) {
      throw new NotFoundError(`Knowledge base ${knowledgeBaseId} not found`);
    }
    return base;
  }

  private async recordAudit(
    context: TenantContext,
    action: string,
    targetType: string,
    targetId: string,
    metadata: Record<string, unknown>,
  ): Promise<void> {
    await this.audit.record({
      organizationId: context.organizationId,
      ...(context.workspaceId ? { workspaceId: context.workspaceId } : {}),
      actorPrincipalId: context.principal.id,
      action,
      targetType,
      targetId,
      metadata,
    });
  }
}
