import { createHash } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthorizationService } from '../../authorization/application/authorization.service.js';
import { contextFor, ORG, WORKSPACE } from '../../runs/application/__fixtures__/run-kit.js';
import { FakeAuditLog } from '../../../infrastructure/http/__fixtures__/fake-repositories.js';
import { ConflictError, ForbiddenError, InvalidInputError, NotFoundError } from '../../../common/errors.js';
import { CHUNKER_VERSION } from '../domain/chunker.js';
import { FakeKnowledgeBaseRepository, FakeKnowledgeDocumentRepository, FakeKnowledgeSearch } from './__fixtures__/fake-knowledge-repositories.js';
import { KnowledgeRetriever } from './knowledge-retriever.js';
import {
  KnowledgeService,
  MAX_BASE_DESCRIPTION_LENGTH,
  MAX_BASE_NAME_LENGTH,
  MAX_CHUNKS_PER_DOCUMENT,
  MAX_DOCUMENT_CONTENT_LENGTH,
  MAX_DOCUMENT_TITLE_LENGTH,
  MAX_DOCUMENTS_PER_BASE,
  MAX_KNOWLEDGE_BASES_PER_WORKSPACE,
  MAX_SEARCH_QUERY_LENGTH,
} from './knowledge.service.js';

const OTHER_WORKSPACE = '99999999-9999-4999-8999-999999999999';
const UNKNOWN = '88888888-8888-4888-8888-888888888888';

const builder = contextFor('builder', 'builder');
const operator = contextFor('operator', 'operator');
const auditor = contextFor('auditor', 'auditor');
const sha256 = (text: string) => createHash('sha256').update(text).digest('hex');

describe('KnowledgeService (ADR-014)', () => {
  let bases: FakeKnowledgeBaseRepository;
  let documents: FakeKnowledgeDocumentRepository;
  let search: FakeKnowledgeSearch;
  let audit: FakeAuditLog;
  let service: KnowledgeService;
  const clock = new Date('2026-03-04T12:00:00.000Z');

  beforeEach(() => {
    bases = new FakeKnowledgeBaseRepository();
    documents = new FakeKnowledgeDocumentRepository();
    search = new FakeKnowledgeSearch(bases, documents);
    audit = new FakeAuditLog();
    service = new KnowledgeService(bases, documents, new KnowledgeRetriever(search), new AuthorizationService(), audit, () => clock);
  });

  const auditOf = (action: string) => audit.events.filter((e) => e.action === action);

  describe('who may do what', () => {
    it.each(['operator', 'auditor'] as const)('denies %s every write', async (role) => {
      const ctx = contextFor(role, role);
      await expect(service.createBase(ctx, { name: 'Docs' })).rejects.toThrow(ForbiddenError);
      const { id } = await service.createBase(builder, { name: 'Docs' });
      await expect(service.archiveBase(ctx, id)).rejects.toThrow(ForbiddenError);
      await expect(service.addDocument(ctx, id, { title: 'T', content: 'text' })).rejects.toThrow(ForbiddenError);
      await expect(service.removeDocument(ctx, id, UNKNOWN)).rejects.toThrow(ForbiddenError);
      expect(bases.rows).toHaveLength(1);
      expect(bases.rows[0]!.status).toBe('active');
    });

    it('lets an operator read and search, but not an auditor', async () => {
      const { id } = await service.createBase(builder, { name: 'Docs' });
      await service.addDocument(builder, id, { title: 'T', content: 'refund policy text' });
      await expect(service.listBases(operator)).resolves.toHaveLength(1);
      await expect(service.getBase(operator, id)).resolves.toMatchObject({ id });
      await expect(service.listDocuments(operator, id)).resolves.toHaveLength(1);
      await expect(service.search(operator, id, 'refund')).resolves.toHaveLength(1);

      await expect(service.listBases(auditor)).rejects.toThrow(ForbiddenError);
      await expect(service.getBase(auditor, id)).rejects.toThrow(ForbiddenError);
      await expect(service.listDocuments(auditor, id)).rejects.toThrow(ForbiddenError);
      await expect(service.search(auditor, id, 'refund')).rejects.toThrow(ForbiddenError);
    });

    it('requires a workspace scope for everything', async () => {
      const unscoped = contextFor('owner', 'owner', null);
      const message = 'Knowledge requires a resolved workspace scope';
      await expect(service.createBase(unscoped, { name: 'Docs' })).rejects.toThrow(message);
      await expect(service.listBases(unscoped)).rejects.toThrow(message);
      await expect(service.getBase(unscoped, UNKNOWN)).rejects.toThrow(message);
      await expect(service.archiveBase(unscoped, UNKNOWN)).rejects.toThrow(message);
      await expect(service.addDocument(unscoped, UNKNOWN, { title: 'T', content: 'x' })).rejects.toThrow(message);
      await expect(service.listDocuments(unscoped, UNKNOWN)).rejects.toThrow(message);
      await expect(service.removeDocument(unscoped, UNKNOWN, UNKNOWN)).rejects.toThrow(message);
      await expect(service.search(unscoped, UNKNOWN, 'x')).rejects.toThrow(message);
    });
  });

  describe('tenant isolation', () => {
    it('treats a base of another workspace as missing on every route', async () => {
      const { id } = await service.createBase(builder, { name: 'Private' });
      const other = contextFor('owner', 'owner', OTHER_WORKSPACE);
      const message = `Knowledge base ${id} not found`;
      await expect(service.getBase(other, id)).rejects.toThrow(message);
      await expect(service.archiveBase(other, id)).rejects.toThrow(message);
      await expect(service.addDocument(other, id, { title: 'T', content: 'x' })).rejects.toThrow(message);
      await expect(service.listDocuments(other, id)).rejects.toThrow(message);
      await expect(service.removeDocument(other, id, UNKNOWN)).rejects.toThrow(message);
      await expect(service.search(other, id, 'anything')).rejects.toThrow(message);
      await expect(service.listBases(other)).resolves.toEqual([]);
      expect(bases.rows[0]!.status).toBe('active');
    });

    it('does not remove a document through the wrong base or workspace', async () => {
      const a = await service.createBase(builder, { name: 'A' });
      const b = await service.createBase(builder, { name: 'B' });
      const { document } = await service.addDocument(builder, a.id, { title: 'T', content: 'only in A' });
      await expect(service.removeDocument(builder, b.id, document.id)).rejects.toThrow(`Document ${document.id} not found`);
      await expect(service.removeDocument(contextFor('owner', 'owner', OTHER_WORKSPACE), a.id, document.id)).rejects.toThrow(NotFoundError);
      expect(documents.rows).toHaveLength(1);
    });
  });

  describe('bases', () => {
    it('creates a base in the caller workspace and audits it without content', async () => {
      const base = await service.createBase(builder, { name: '  Support   handbook ', description: 'Policies' });
      expect(base).toMatchObject({
        organizationId: ORG,
        workspaceId: WORKSPACE,
        name: 'Support handbook',
        description: 'Policies',
        status: 'active',
        createdByPrincipalId: builder.principal.id,
      });
      expect(auditOf('knowledge_base.created')).toEqual([
        expect.objectContaining({ organizationId: ORG, workspaceId: WORKSPACE, actorPrincipalId: builder.principal.id, targetType: 'knowledge_base', targetId: base.id }),
      ]);
    });

    it('stores a blank description as none', async () => {
      expect((await service.createBase(builder, { name: 'A', description: '   ' })).description).toBeNull();
      expect((await service.createBase(builder, { name: 'B' })).description).toBeNull();
    });

    it('validates the name and description', async () => {
      await expect(service.createBase(builder, { name: '   ' })).rejects.toThrow(`Knowledge base name must be between 1 and ${MAX_BASE_NAME_LENGTH} characters`);
      await expect(service.createBase(builder, { name: 'n'.repeat(MAX_BASE_NAME_LENGTH + 1) })).rejects.toThrow(InvalidInputError);
      await expect(service.createBase(builder, { name: 'n'.repeat(MAX_BASE_NAME_LENGTH) })).resolves.toBeDefined();
      await expect(service.createBase(builder, { name: 'D', description: 'd'.repeat(MAX_BASE_DESCRIPTION_LENGTH + 1) })).rejects.toThrow(
        `Knowledge base description must be at most ${MAX_BASE_DESCRIPTION_LENGTH} characters`,
      );
      await expect(service.createBase(builder, { name: 'E', description: 'd'.repeat(MAX_BASE_DESCRIPTION_LENGTH) })).resolves.toBeDefined();
    });

    it('refuses a second active base with the same name, and frees the name once archived', async () => {
      const first = await service.createBase(builder, { name: 'Docs' });
      await expect(service.createBase(builder, { name: 'Docs' })).rejects.toThrow('A knowledge base with this name already exists in the workspace');
      await service.archiveBase(builder, first.id);
      await expect(service.createBase(builder, { name: 'Docs' })).resolves.toMatchObject({ status: 'active' });
    });

    it('reports a name conflict when two identical requests race past the lookup', async () => {
      await service.createBase(builder, { name: 'Docs' });
      vi.spyOn(bases, 'findActiveByName').mockResolvedValueOnce(undefined);
      await expect(service.createBase(builder, { name: 'Docs' })).rejects.toThrow(ConflictError);
    });

    it('surfaces a storage failure that is not a name conflict', async () => {
      vi.spyOn(bases, 'create').mockRejectedValueOnce(new Error('storage down'));
      await expect(service.createBase(builder, { name: 'Docs' })).rejects.toThrow('storage down');
    });

    it('caps the number of active bases per workspace, counting only active ones', async () => {
      for (let n = 0; n < MAX_KNOWLEDGE_BASES_PER_WORKSPACE; n += 1) await service.createBase(builder, { name: `Base ${n}` });
      await expect(service.createBase(builder, { name: 'One too many' })).rejects.toThrow(
        `A workspace can have at most ${MAX_KNOWLEDGE_BASES_PER_WORKSPACE} active knowledge bases`,
      );
      await service.archiveBase(builder, bases.rows[0]!.id);
      await expect(service.createBase(builder, { name: 'Room again' })).resolves.toBeDefined();
      await expect(service.createBase(contextFor('builder', 'other', OTHER_WORKSPACE), { name: 'Elsewhere' })).resolves.toBeDefined();
    });

    it('archives once, stamping the time, and audits it', async () => {
      const { id } = await service.createBase(builder, { name: 'Docs' });
      const archived = await service.archiveBase(builder, id);
      expect(archived).toMatchObject({ id, status: 'archived', archivedAt: clock });
      expect(auditOf('knowledge_base.archived')).toEqual([expect.objectContaining({ targetType: 'knowledge_base', targetId: id })]);
      await expect(service.archiveBase(builder, id)).rejects.toThrow('Knowledge base is already archived');
      expect(auditOf('knowledge_base.archived')).toHaveLength(1);
    });

    it('says a base was not found', async () => {
      await expect(service.getBase(builder, UNKNOWN)).rejects.toThrow(`Knowledge base ${UNKNOWN} not found`);
      await expect(service.archiveBase(builder, UNKNOWN)).rejects.toThrow(NotFoundError);
    });
  });

  describe('adding documents', () => {
    async function base() {
      return service.createBase(builder, { name: 'Docs' });
    }

    it('normalizes, chunks and stores the document, then audits ids, checksum and sizes only', async () => {
      const { id } = await base();
      const { document, replayed } = await service.addDocument(builder, id, {
        title: '  Refund\npolicy  ',
        content: '# Refunds\r\n\r\n\r\n\r\nRefunds take five days.  \u0000',
      });
      const content = '# Refunds\n\nRefunds take five days.';

      expect(replayed).toBe(false);
      expect(document).toMatchObject({
        knowledgeBaseId: id,
        workspaceId: WORKSPACE,
        title: 'Refund policy',
        checksum: sha256(content),
        contentLength: content.length,
        chunkCount: 1,
        chunkerVersion: CHUNKER_VERSION,
        createdByPrincipalId: builder.principal.id,
      });
      expect(document).not.toHaveProperty('content');
      expect(documents.rows[0]!.content).toBe(content);
      expect(documents.chunks.map((c) => [c.ordinal, c.section])).toEqual([[0, 'Refunds']]);

      const [event] = auditOf('knowledge_document.added');
      expect(event).toMatchObject({
        actorPrincipalId: builder.principal.id,
        targetType: 'knowledge_document',
        targetId: document.id,
        metadata: { knowledgeBaseId: id, checksum: sha256(content), contentLength: content.length, chunkCount: 1 },
      });
      expect(JSON.stringify(audit.events)).not.toContain('five days');
      expect(JSON.stringify(audit.events)).not.toContain('Refund policy');
    });

    it('returns the existing document, and audits nothing new, when the same content is added again', async () => {
      const { id } = await base();
      const first = await service.addDocument(builder, id, { title: 'First', content: 'same words' });
      const again = await service.addDocument(builder, id, { title: 'Renamed', content: 'same words\r\n' });
      expect(again.replayed).toBe(true);
      expect(again.document.id).toBe(first.document.id);
      expect(again.document.title).toBe('First');
      expect(documents.rows).toHaveLength(1);
      expect(auditOf('knowledge_document.added')).toHaveLength(1);
    });

    it('allows the same content in different bases', async () => {
      const a = await base();
      const b = await service.createBase(builder, { name: 'Other' });
      await service.addDocument(builder, a.id, { title: 'T', content: 'shared text' });
      await expect(service.addDocument(builder, b.id, { title: 'T', content: 'shared text' })).resolves.toMatchObject({ replayed: false });
    });

    it('replays the winner when the same content is added at the same time', async () => {
      const { id } = await base();
      const first = await service.addDocument(builder, id, { title: 'T', content: 'racing text' });
      vi.spyOn(documents, 'findByChecksum').mockResolvedValueOnce(undefined);
      const second = await service.addDocument(builder, id, { title: 'T', content: 'racing text' });
      expect(second).toMatchObject({ replayed: true, document: { id: first.document.id } });
      expect(auditOf('knowledge_document.added')).toHaveLength(1);
    });

    it('surfaces a storage failure that is not a duplicate', async () => {
      const { id } = await base();
      vi.spyOn(documents, 'createWithChunks').mockRejectedValueOnce(new Error('storage down'));
      await expect(service.addDocument(builder, id, { title: 'T', content: 'x text' })).rejects.toThrow('storage down');
      expect(auditOf('knowledge_document.added')).toHaveLength(0);
    });

    it('validates the title', async () => {
      const { id } = await base();
      const message = `Document title must be between 1 and ${MAX_DOCUMENT_TITLE_LENGTH} characters`;
      await expect(service.addDocument(builder, id, { title: '  \n ', content: 'text' })).rejects.toThrow(message);
      await expect(service.addDocument(builder, id, { title: 't'.repeat(MAX_DOCUMENT_TITLE_LENGTH + 1), content: 'text' })).rejects.toThrow(InvalidInputError);
      await expect(service.addDocument(builder, id, { title: 't'.repeat(MAX_DOCUMENT_TITLE_LENGTH), content: 'text' })).resolves.toBeDefined();
    });

    it('validates the content length, counting after normalization', async () => {
      const { id } = await base();
      const message = `Document content must be between 1 and ${MAX_DOCUMENT_CONTENT_LENGTH} characters`;
      await expect(service.addDocument(builder, id, { title: 'T', content: ' \u0000 \n ' })).rejects.toThrow(message);
      await expect(service.addDocument(builder, id, { title: 'T', content: 'x'.repeat(MAX_DOCUMENT_CONTENT_LENGTH + 1) })).rejects.toThrow(message);
      await expect(service.addDocument(builder, id, { title: 'T', content: 'x'.repeat(MAX_DOCUMENT_CONTENT_LENGTH * 2 + 1) })).rejects.toThrow(message);
      const padded = `${'x'.repeat(MAX_DOCUMENT_CONTENT_LENGTH)}${' '.repeat(50)}`;
      await expect(service.addDocument(builder, id, { title: 'T', content: padded })).resolves.toMatchObject({ replayed: false });
    });

    it('refuses a document that would split into too many passages', async () => {
      const { id } = await base();
      const headings = Array.from({ length: MAX_CHUNKS_PER_DOCUMENT + 1 }, () => '# h').join('\n\n');
      await expect(service.addDocument(builder, id, { title: 'T', content: headings })).rejects.toThrow(
        `Document is too fragmented: it would produce more than ${MAX_CHUNKS_PER_DOCUMENT} passages`,
      );
      const exactly = Array.from({ length: MAX_CHUNKS_PER_DOCUMENT }, () => '# h').join('\n\n');
      await expect(service.addDocument(builder, id, { title: 'T', content: exactly })).resolves.toMatchObject({ document: { chunkCount: MAX_CHUNKS_PER_DOCUMENT } });
    });

    it('caps the documents per base', async () => {
      const { id } = await base();
      for (let n = 0; n < MAX_DOCUMENTS_PER_BASE; n += 1) await service.addDocument(builder, id, { title: `Doc ${n}`, content: `content number ${n}` });
      await expect(service.addDocument(builder, id, { title: 'More', content: 'one more document' })).rejects.toThrow(
        `A knowledge base can hold at most ${MAX_DOCUMENTS_PER_BASE} documents`,
      );
      await expect(service.addDocument(builder, id, { title: 'Again', content: 'content number 0' })).resolves.toMatchObject({ replayed: true });
    });

    it('refuses to add to an archived base', async () => {
      const { id } = await base();
      await service.archiveBase(builder, id);
      await expect(service.addDocument(builder, id, { title: 'T', content: 'text' })).rejects.toThrow('Knowledge base is archived');
      expect(documents.rows).toHaveLength(0);
    });
  });

  describe('listing and removing documents', () => {
    it('lists summaries without text, newest first', async () => {
      const { id } = await service.createBase(builder, { name: 'Docs' });
      await service.addDocument(builder, id, { title: 'Older', content: 'older text' });
      await service.addDocument(builder, id, { title: 'Newer', content: 'newer text' });
      const listed = await service.listDocuments(builder, id);
      expect(listed.map((d) => d.title)).toEqual(['Newer', 'Older']);
      expect(listed[0]).not.toHaveProperty('content');
    });

    it('removes a document with its passages, audits it and stops retrieving it', async () => {
      const { id } = await service.createBase(builder, { name: 'Docs' });
      const { document } = await service.addDocument(builder, id, { title: 'Doomed', content: 'unique zebra facts' });
      expect(await service.search(builder, id, 'zebra')).toHaveLength(1);

      await service.removeDocument(builder, id, document.id);
      expect(documents.rows).toHaveLength(0);
      expect(documents.chunks).toHaveLength(0);
      expect(await service.search(builder, id, 'zebra')).toEqual([]);
      expect(auditOf('knowledge_document.removed')).toEqual([
        expect.objectContaining({ targetType: 'knowledge_document', targetId: document.id, metadata: { knowledgeBaseId: id, checksum: document.checksum } }),
      ]);
      await expect(service.removeDocument(builder, id, document.id)).rejects.toThrow(`Document ${document.id} not found`);
    });

    it('reports a document that vanished between the lookup and the delete', async () => {
      const { id } = await service.createBase(builder, { name: 'Docs' });
      const { document } = await service.addDocument(builder, id, { title: 'T', content: 'some text' });
      vi.spyOn(documents, 'delete').mockResolvedValueOnce(false);
      await expect(service.removeDocument(builder, id, document.id)).rejects.toThrow(NotFoundError);
      expect(auditOf('knowledge_document.removed')).toHaveLength(0);
    });
  });

  describe('searching', () => {
    it('returns passages with their source, scoped to the one base', async () => {
      const a = await service.createBase(builder, { name: 'A' });
      const b = await service.createBase(builder, { name: 'B' });
      await service.addDocument(builder, a.id, { title: 'Refunds', content: '# Refunds\n\nRefunds take five days.' });
      await service.addDocument(builder, b.id, { title: 'Other', content: 'Refunds in another base' });

      const results = await service.search(builder, a.id, 'how long do refunds take');
      expect(results).toHaveLength(1);
      expect(results[0]).toMatchObject({ knowledgeBaseId: a.id, documentTitle: 'Refunds', section: 'Refunds', ordinal: 0 });
      expect(search.requests[0]).toMatchObject({ workspaceId: WORKSPACE, knowledgeBaseIds: [a.id] });
    });

    it('validates the query', async () => {
      const { id } = await service.createBase(builder, { name: 'Docs' });
      const message = `Search query must be between 1 and ${MAX_SEARCH_QUERY_LENGTH} characters`;
      await expect(service.search(builder, id, '   ')).rejects.toThrow(message);
      await expect(service.search(builder, id, 'q'.repeat(MAX_SEARCH_QUERY_LENGTH + 1))).rejects.toThrow(message);
      await expect(service.search(builder, id, '?! ... --')).rejects.toThrow('Search query has no searchable terms');
      await expect(service.search(builder, id, `${'q'.repeat(MAX_SEARCH_QUERY_LENGTH - 1)} `)).resolves.toEqual([]);
      expect(search.requests).toHaveLength(1);
    });

    it('refuses to search an archived base', async () => {
      const { id } = await service.createBase(builder, { name: 'Docs' });
      await service.archiveBase(builder, id);
      await expect(service.search(builder, id, 'anything')).rejects.toThrow('Knowledge base is archived');
      expect(search.requests).toHaveLength(0);
    });
  });
});
