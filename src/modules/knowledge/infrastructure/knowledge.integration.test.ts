import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { createTestDatabase, type TestDatabase } from '../../../infrastructure/database/__fixtures__/test-database.js';
import { PrincipalRepository } from '../../identity/infrastructure/principal.repository.js';
import { OrganizationRepository } from '../../organizations/infrastructure/organization.repository.js';
import { WorkspaceRepository } from '../../workspaces/infrastructure/workspace.repository.js';
import { chunkText, CHUNKER_VERSION, normalizeText } from '../domain/chunker.js';
import { toSearchTerms } from '../domain/search-query.js';
import { KnowledgeBaseRepository } from './knowledge-base.repository.js';
import { KnowledgeDocumentRepository } from './knowledge-document.repository.js';
import { KnowledgeSearchRepository } from './knowledge-search.repository.js';
import { knowledgeChunks } from './schema.js';

describe('knowledge on real Postgres (integration)', () => {
  let database: TestDatabase;
  let bases: KnowledgeBaseRepository;
  let documents: KnowledgeDocumentRepository;
  let search: KnowledgeSearchRepository;
  let principals: PrincipalRepository;
  let organizations: OrganizationRepository;
  let workspaces: WorkspaceRepository;

  beforeAll(async () => {
    database = await createTestDatabase();
    const { db } = database;
    bases = new KnowledgeBaseRepository(db);
    documents = new KnowledgeDocumentRepository(db);
    search = new KnowledgeSearchRepository(db);
    principals = new PrincipalRepository(db);
    organizations = new OrganizationRepository(db);
    workspaces = new WorkspaceRepository(db);
  });

  afterAll(async () => {
    await database.close();
  });

  async function tenant(slug: string) {
    const principal = await principals.create({ type: 'user', email: `${slug}@example.com`, name: slug });
    const organization = await organizations.create({ name: slug, slug });
    const workspace = await workspaces.create({ organizationId: organization.id, name: 'Main', slug: 'main' });
    return { principal, organization, workspace };
  }

  type Tenant = Awaited<ReturnType<typeof tenant>>;

  const newBase = (t: Tenant, name: string) =>
    bases.create({ organizationId: t.organization.id, workspaceId: t.workspace.id, name, createdByPrincipalId: t.principal.id });

  async function addDocument(t: Tenant, knowledgeBaseId: string, title: string, raw: string) {
    const content = normalizeText(raw);
    return documents.createWithChunks(
      {
        organizationId: t.organization.id,
        workspaceId: t.workspace.id,
        knowledgeBaseId,
        title,
        content,
        checksum: `${title}:${content.length}:${content.slice(0, 16)}`,
        contentLength: content.length,
        chunkCount: chunkText(content).length,
        chunkerVersion: CHUNKER_VERSION,
        createdByPrincipalId: t.principal.id,
      },
      chunkText(content),
    );
  }

  const find = (t: Tenant, ids: string[], query: string, limit = 3) =>
    search.search({ workspaceId: t.workspace.id, knowledgeBaseIds: ids, terms: toSearchTerms(query), limit });

  describe('bases', () => {
    it('keeps active names unique per workspace, and an archived base frees its name', async () => {
      const t = await tenant('kb-names');
      const first = await newBase(t, 'Support');
      await expect(newBase(t, 'Support')).rejects.toThrow();
      expect((await bases.findActiveByName(t.workspace.id, 'Support'))?.id).toBe(first.id);

      await bases.archive(t.workspace.id, first.id, new Date());
      expect(await bases.findActiveByName(t.workspace.id, 'Support')).toBeUndefined();
      await expect(newBase(t, 'Support')).resolves.toMatchObject({ status: 'active' });
    });

    it('allows the same name in another workspace', async () => {
      const a = await tenant('kb-iso-a');
      const b = await tenant('kb-iso-b');
      await newBase(a, 'Handbook');
      await expect(newBase(b, 'Handbook')).resolves.toBeDefined();
    });

    it('archives exactly once and counts only active bases', async () => {
      const t = await tenant('kb-archive');
      const one = await newBase(t, 'One');
      await newBase(t, 'Two');
      expect(await bases.countActive(t.workspace.id)).toBe(2);

      const archivedAt = new Date('2026-03-04T12:00:00.000Z');
      expect(await bases.archive(t.workspace.id, one.id, archivedAt)).toMatchObject({ status: 'archived', archivedAt });
      expect(await bases.archive(t.workspace.id, one.id, new Date())).toBeUndefined();
      expect(await bases.countActive(t.workspace.id)).toBe(1);
      expect((await bases.listByWorkspace(t.workspace.id)).map((b) => b.name)).toEqual(['One', 'Two']);
    });

    it('does not find a base through another workspace', async () => {
      const a = await tenant('kb-find-a');
      const b = await tenant('kb-find-b');
      const base = await newBase(a, 'Private');
      expect(await bases.findById(b.workspace.id, base.id)).toBeUndefined();
      expect(await bases.archive(b.workspace.id, base.id, new Date())).toBeUndefined();
    });
  });

  describe('documents and chunks', () => {
    it('stores a document with its chunks and lists it without the text', async () => {
      const t = await tenant('doc-store');
      const base = await newBase(t, 'Docs');
      const text = '# Refunds\n\nRefunds take five days.\n\n# Shipping\n\nShipping takes two days.';
      const document = await addDocument(t, base.id, 'Policies', text);

      expect(document).toMatchObject({ title: 'Policies', chunkCount: 2, chunkerVersion: CHUNKER_VERSION, status: 'ready' });
      expect(document).not.toHaveProperty('content');
      const stored = await database.db.select().from(knowledgeChunks).where(eq(knowledgeChunks.documentId, document.id));
      expect(stored.map((c) => [c.ordinal, c.section])).toEqual(expect.arrayContaining([[0, 'Refunds'], [1, 'Shipping']]));
      expect(stored.every((c) => c.workspaceId === t.workspace.id && c.knowledgeBaseId === base.id)).toBe(true);

      const listed = await documents.listByBase(t.workspace.id, base.id);
      expect(listed.map((d) => d.id)).toEqual([document.id]);
      expect(listed[0]).not.toHaveProperty('content');
      expect(await documents.countByBase(base.id)).toBe(1);
    });

    it('refuses the same content twice in one base and finds it by checksum', async () => {
      const t = await tenant('doc-dup');
      const base = await newBase(t, 'Docs');
      const first = await addDocument(t, base.id, 'Same', 'identical content here');
      await expect(addDocument(t, base.id, 'Same', 'identical content here')).rejects.toThrow();
      expect((await documents.findByChecksum(base.id, first.checksum))?.id).toBe(first.id);
      const other = await newBase(t, 'Other');
      await expect(addDocument(t, other.id, 'Same', 'identical content here')).resolves.toBeDefined();
    });

    it('is atomic: a failing chunk insert leaves no document behind', async () => {
      const t = await tenant('doc-atomic');
      const base = await newBase(t, 'Docs');
      const duplicateOrdinals = [
        { ordinal: 0, text: 'one', section: null },
        { ordinal: 0, text: 'two', section: null },
      ];
      await expect(
        documents.createWithChunks(
          {
            organizationId: t.organization.id,
            workspaceId: t.workspace.id,
            knowledgeBaseId: base.id,
            title: 'Broken',
            content: 'one two',
            checksum: 'broken',
            contentLength: 7,
            chunkCount: 2,
            chunkerVersion: CHUNKER_VERSION,
            createdByPrincipalId: t.principal.id,
          },
          duplicateOrdinals,
        ),
      ).rejects.toThrow();
      expect(await documents.countByBase(base.id)).toBe(0);
    });

    it('deletes the document together with its chunks, only inside its workspace', async () => {
      const a = await tenant('doc-del-a');
      const b = await tenant('doc-del-b');
      const base = await newBase(a, 'Docs');
      const document = await addDocument(a, base.id, 'Doomed', 'to be removed soon');

      expect(await documents.delete(b.workspace.id, document.id)).toBe(false);
      expect(await documents.findSummaryById(a.workspace.id, document.id)).toBeDefined();

      expect(await documents.delete(a.workspace.id, document.id)).toBe(true);
      expect(await documents.delete(a.workspace.id, document.id)).toBe(false);
      expect(await database.db.select().from(knowledgeChunks).where(eq(knowledgeChunks.documentId, document.id))).toEqual([]);
      expect(await find(a, [base.id], 'removed')).toEqual([]);
    });
  });

  describe('retrieval', () => {
    it('finds passages by any term, best match first, with the source identity', async () => {
      const t = await tenant('search-basic');
      const base = await newBase(t, 'Docs');
      const refunds = await addDocument(t, base.id, 'Refund policy', '# Refunds\n\nCustomers get a refund within five business days after the return arrives.');
      await addDocument(t, base.id, 'Shipping', 'Orders ship within two business days.');

      const results = await find(t, [base.id], 'how long does a refund take after the return');
      expect(results[0]).toMatchObject({
        knowledgeBaseId: base.id,
        documentId: refunds.id,
        documentTitle: 'Refund policy',
        ordinal: 0,
        section: 'Refunds',
      });
      expect(results[0]!.text).toContain('five business days');
      expect(results[0]!.score).toBeGreaterThan(0);
      expect(results.length).toBeGreaterThanOrEqual(1);
      expect(results.map((r) => r.score)).toEqual([...results.map((r) => r.score)].sort((x, y) => y - x));
    });

    it('is case insensitive and never reads query text as operators', async () => {
      const t = await tenant('search-safe');
      const base = await newBase(t, 'Docs');
      await addDocument(t, base.id, 'Doc', 'The Quarterly REPORT is due on Friday.');
      expect(await find(t, [base.id], 'quarterly report')).toHaveLength(1);
      expect(await find(t, [base.id], "report' | !friday & (x) :* <->")).toHaveLength(1);
      expect(await find(t, [base.id], '!!! ???')).toEqual([]);
    });

    it('returns nothing for an empty scope or empty terms', async () => {
      const t = await tenant('search-empty');
      const base = await newBase(t, 'Docs');
      await addDocument(t, base.id, 'Doc', 'anything searchable');
      expect(await search.search({ workspaceId: t.workspace.id, knowledgeBaseIds: [], terms: ['anything'], limit: 3 })).toEqual([]);
      expect(await search.search({ workspaceId: t.workspace.id, knowledgeBaseIds: [base.id], terms: [], limit: 3 })).toEqual([]);
      expect(await search.search({ workspaceId: t.workspace.id, knowledgeBaseIds: [base.id], terms: ["x'; drop table"], limit: 3 })).toEqual([]);
    });

    it('limits the number of results', async () => {
      const t = await tenant('search-limit');
      const base = await newBase(t, 'Docs');
      for (let n = 0; n < 5; n += 1) await addDocument(t, base.id, `Doc ${n}`, `common keyword number ${n}`);
      expect(await find(t, [base.id], 'common keyword', 2)).toHaveLength(2);
      expect(await find(t, [base.id], 'common keyword', 10)).toHaveLength(5);
    });

    describe('permission before retrieval', () => {
      it('never returns another workspace content, even when its base id is passed', async () => {
        const a = await tenant('perm-a');
        const b = await tenant('perm-b');
        const baseA = await newBase(a, 'Secrets');
        const baseB = await newBase(b, 'Mine');
        await addDocument(a, baseA.id, 'Confidential', 'the launch codename is falcon');
        await addDocument(b, baseB.id, 'Mine', 'my own notes about lunch');

        expect(await find(b, [baseA.id], 'falcon codename launch')).toEqual([]);
        expect(await find(b, [baseA.id, baseB.id], 'falcon codename launch lunch').then((r) => r.map((x) => x.documentTitle))).toEqual(['Mine']);
        expect(await find(a, [baseA.id], 'falcon')).toHaveLength(1);
      });

      it('only searches the bases it was given', async () => {
        const t = await tenant('perm-scope');
        const allowed = await newBase(t, 'Allowed');
        const other = await newBase(t, 'Other');
        await addDocument(t, allowed.id, 'In', 'budget forecast for the year');
        await addDocument(t, other.id, 'Out', 'budget forecast with salaries');
        expect((await find(t, [allowed.id], 'budget forecast')).map((r) => r.documentTitle)).toEqual(['In']);
      });

      it('stops returning anything from a base as soon as it is archived', async () => {
        const t = await tenant('perm-archive');
        const base = await newBase(t, 'Soon gone');
        await addDocument(t, base.id, 'Doc', 'ephemeral knowledge about pandas');
        expect(await find(t, [base.id], 'pandas')).toHaveLength(1);
        await bases.archive(t.workspace.id, base.id, new Date());
        expect(await find(t, [base.id], 'pandas')).toEqual([]);
      });
    });

    describe('known answers (recall@3)', () => {
      const corpus: { title: string; text: string }[] = [
        { title: 'Refund policy', text: '# Refunds\n\nRefunds are issued to the original card within five business days.' },
        { title: 'Shipping times', text: '# Shipping\n\nStandard shipping takes three to five business days. Express shipping takes one day.' },
        { title: 'Password reset', text: '# Accounts\n\nTo reset a password use the forgot password link on the sign in page.' },
        { title: 'Invoices', text: '# Billing\n\nInvoices are emailed on the first day of each month as a PDF attachment.' },
        { title: 'Data retention', text: '# Privacy\n\nWe keep account data for thirty days after deletion and then erase it permanently.' },
      ];
      const questions: [string, string][] = [
        ['How long until my refund arrives?', 'Refund policy'],
        ['how many days does express shipping take', 'Shipping times'],
        ['I forgot my password, how do I reset it', 'Password reset'],
        ['when do you email the invoice pdf', 'Invoices'],
        ['how long do you keep my data after I delete the account', 'Data retention'],
      ];

      it('finds the expected source for every question within the top three', async () => {
        const t = await tenant('recall');
        const base = await newBase(t, 'FAQ');
        for (const doc of corpus) await addDocument(t, base.id, doc.title, doc.text);

        const hits = await Promise.all(
          questions.map(async ([question, expected]) => (await find(t, [base.id], question)).some((r) => r.documentTitle === expected)),
        );
        expect(hits).toEqual(questions.map(() => true));
      });
    });
  });
});
