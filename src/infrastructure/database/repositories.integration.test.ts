import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestDatabase, type TestDatabase } from './__fixtures__/test-database.js';
import { PrincipalRepository } from '../../modules/identity/infrastructure/principal.repository.js';
import { OrganizationRepository } from '../../modules/organizations/infrastructure/organization.repository.js';
import { MembershipRepository } from '../../modules/organizations/infrastructure/membership.repository.js';
import { WorkspaceRepository } from '../../modules/workspaces/infrastructure/workspace.repository.js';
import { AgentRepository } from '../../modules/agents/infrastructure/agent.repository.js';
import { AgentDraftRepository } from '../../modules/agents/infrastructure/agent-draft.repository.js';
import { AgentVersionRepository } from '../../modules/agents/infrastructure/agent-version.repository.js';
import { AuditLogRepository } from '../../modules/audit/infrastructure/audit-log.repository.js';
import { auditEvents } from '../../modules/audit/infrastructure/schema.js';

describe('Drizzle repositories on real Postgres (integration)', () => {
  let database: TestDatabase;
  let principals: PrincipalRepository;
  let organizations: OrganizationRepository;
  let memberships: MembershipRepository;
  let workspaces: WorkspaceRepository;
  let agents: AgentRepository;
  let drafts: AgentDraftRepository;
  let versions: AgentVersionRepository;
  let audit: AuditLogRepository;

  beforeAll(async () => {
    database = await createTestDatabase();
    const { db } = database;
    principals = new PrincipalRepository(db);
    organizations = new OrganizationRepository(db);
    memberships = new MembershipRepository(db);
    workspaces = new WorkspaceRepository(db);
    agents = new AgentRepository(db);
    drafts = new AgentDraftRepository(db);
    versions = new AgentVersionRepository(db);
    audit = new AuditLogRepository(db);
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

  describe('uniqueness constraints', () => {
    it('rejects a duplicate organization slug at the database level', async () => {
      await organizations.create({ name: 'Dup', slug: 'dup-org' });
      await expect(organizations.create({ name: 'Dup 2', slug: 'dup-org' })).rejects.toThrow();
    });

    it('rejects a duplicate principal email', async () => {
      await principals.create({ type: 'user', email: 'same@example.com', name: 'A' });
      await expect(principals.create({ type: 'user', email: 'same@example.com', name: 'B' })).rejects.toThrow();
    });

    it('scopes workspace slugs per organization', async () => {
      const a = await organizations.create({ name: 'A', slug: 'ws-slug-a' });
      const b = await organizations.create({ name: 'B', slug: 'ws-slug-b' });
      await workspaces.create({ organizationId: a.id, name: 'Ops', slug: 'ops' });
      await expect(workspaces.create({ organizationId: a.id, name: 'Ops 2', slug: 'ops' })).rejects.toThrow();
      await expect(workspaces.create({ organizationId: b.id, name: 'Ops', slug: 'ops' })).resolves.toBeDefined();
    });

    it('scopes agent slugs per workspace and version numbers per agent', async () => {
      const t = await tenant('uniq-agent');
      const other = await workspaces.create({ organizationId: t.organization.id, name: 'Other', slug: 'other' });
      const base = { organizationId: t.organization.id, name: 'Bot', slug: 'bot' };
      const agent = await agents.create({ ...base, workspaceId: t.workspace.id });
      await expect(agents.create({ ...base, workspaceId: t.workspace.id })).rejects.toThrow();
      await expect(agents.create({ ...base, workspaceId: other.id })).resolves.toBeDefined();

      const snapshot = {
        agentId: agent.id,
        versionNumber: 1,
        instructions: 'x',
        modelPolicy: {},
        knowledgeBindings: [],
        toolBindings: [],
        memoryPolicy: {},
        guardrails: {},
        checksum: 'c'.repeat(64),
        publishedByPrincipalId: t.principal.id,
      };
      await versions.create(snapshot);
      await expect(versions.create(snapshot)).rejects.toThrow();
    });
  });

  describe('tenant scoping of lookups', () => {
    it('finds agents only inside their own workspace', async () => {
      const a = await tenant('scope-a');
      const b = await tenant('scope-b');
      const agent = await agents.create({
        organizationId: a.organization.id,
        workspaceId: a.workspace.id,
        name: 'Secret',
        slug: 'secret',
      });

      expect(await agents.findById(a.workspace.id, agent.id)).toMatchObject({ id: agent.id });
      expect(await agents.findById(b.workspace.id, agent.id)).toBeUndefined();
      expect(await agents.findBySlug(b.workspace.id, 'secret')).toBeUndefined();
      expect(await agents.listByWorkspace(b.workspace.id)).toEqual([]);
    });

    it('finds workspaces only inside their own organization', async () => {
      const a = await tenant('ws-scope-a');
      const b = await tenant('ws-scope-b');
      expect(await workspaces.findById(a.organization.id, a.workspace.id)).toBeDefined();
      expect(await workspaces.findById(b.organization.id, a.workspace.id)).toBeUndefined();
      expect(await workspaces.listByOrganization(b.organization.id)).toHaveLength(1);
    });

    it('finds memberships only inside their own organization', async () => {
      const a = await tenant('mem-a');
      const b = await tenant('mem-b');
      await memberships.create({
        organizationId: a.organization.id,
        principalId: a.principal.id,
        role: 'owner',
        status: 'active',
      });
      expect(await memberships.findByPrincipalInOrganization(a.organization.id, a.principal.id)).toMatchObject({
        role: 'owner',
      });
      expect(await memberships.findByPrincipalInOrganization(b.organization.id, a.principal.id)).toBeUndefined();
    });
  });

  describe('agent lifecycle persistence', () => {
    it('keeps the draft mutable while published versions stay immutable and ordered', async () => {
      const t = await tenant('lifecycle');
      const agent = await agents.create({
        organizationId: t.organization.id,
        workspaceId: t.workspace.id,
        name: 'Bot',
        slug: 'bot',
      });
      await drafts.create({ agentId: agent.id });
      await drafts.update(agent.id, { instructions: 'v1 text', guardrails: { maxOutputTokens: 300 } });
      const draft = await drafts.findByAgentId(agent.id);
      expect(draft).toMatchObject({ instructions: 'v1 text', guardrails: { maxOutputTokens: 300 } });

      for (const versionNumber of [1, 2, 3]) {
        await versions.create({
          agentId: agent.id,
          versionNumber,
          instructions: `text ${versionNumber}`,
          modelPolicy: {},
          knowledgeBindings: [],
          toolBindings: [],
          memoryPolicy: {},
          guardrails: {},
          checksum: String(versionNumber).repeat(64).slice(0, 64),
          publishedByPrincipalId: t.principal.id,
        });
      }
      expect((await versions.listByAgent(agent.id)).map((v) => v.versionNumber)).toEqual([3, 2, 1]);
      expect(await versions.findLatestVersionNumber(agent.id)).toBe(3);

      const updated = await agents.updateLifecycle(agent.id, { status: 'active' });
      expect(updated.status).toBe('active');
      expect((await versions.listByAgent(agent.id)).find((v) => v.versionNumber === 1)?.instructions).toBe('text 1');
    });
  });

  describe('audit log', () => {
    async function seedEvents(slug: string, count: number) {
      const t = await tenant(slug);
      for (let index = 0; index < count; index += 1) {
        await audit.record({
          organizationId: t.organization.id,
          ...(index % 2 === 0 ? { workspaceId: t.workspace.id } : {}),
          actorPrincipalId: t.principal.id,
          action: index % 2 === 0 ? 'agent.created' : 'agent.disabled',
          targetType: 'agent',
          targetId: crypto.randomUUID(),
          metadata: { n: index },
        });
      }
      return t;
    }

    it('returns events newest first, scoped to the organization', async () => {
      const a = await seedEvents('audit-a', 3);
      await seedEvents('audit-b', 2);

      const events = await audit.list(a.organization.id, {}, { limit: 10 });
      expect(events).toHaveLength(3);
      expect(events.every((e) => e.organizationId === a.organization.id)).toBe(true);
      const times = events.map((e) => e.createdAt.getTime());
      expect([...times].sort((x, y) => y - x)).toEqual(times);
      expect(events[0]?.metadata).toEqual({ n: 2 });
    });

    it('pages with a keyset cursor without gaps or repeats', async () => {
      const t = await seedEvents('audit-page', 5);
      const all = await audit.list(t.organization.id, {}, { limit: 10 });

      const seen: string[] = [];
      let after: { createdAt: Date; id: string } | undefined;
      for (let guard = 0; guard < 10; guard += 1) {
        const page = await audit.list(t.organization.id, {}, { limit: 2, ...(after ? { after } : {}) });
        seen.push(...page.map((e) => e.id));
        const last = page[page.length - 1];
        if (page.length < 2 || !last) break;
        after = { createdAt: last.createdAt, id: last.id };
      }
      expect(seen).toEqual(all.map((e) => e.id));
    });

    it('breaks ties between identical timestamps by id, so nothing is skipped', async () => {
      const t = await tenant('audit-ties');
      const sameTime = new Date('2026-05-05T10:00:00.000Z');
      await database.db.insert(auditEvents).values(
        [1, 2, 3, 4].map((n) => ({
          organizationId: t.organization.id,
          actorPrincipalId: t.principal.id,
          action: 'agent.created',
          targetType: 'agent',
          targetId: crypto.randomUUID(),
          metadata: { n },
          createdAt: sameTime,
        })),
      );

      const all = await audit.list(t.organization.id, {}, { limit: 10 });
      expect(all).toHaveLength(4);
      const seen: string[] = [];
      let after: { createdAt: Date; id: string } | undefined;
      for (let guard = 0; guard < 10; guard += 1) {
        const page = await audit.list(t.organization.id, {}, { limit: 1, ...(after ? { after } : {}) });
        const [only] = page;
        if (!only) break;
        seen.push(only.id);
        after = { createdAt: only.createdAt, id: only.id };
      }
      expect(seen).toEqual(all.map((e) => e.id));
      expect(new Set(seen).size).toBe(4);
    });

    it('filters by action, workspace and actor without leaving the organization', async () => {
      const t = await seedEvents('audit-filter', 4);
      const other = await seedEvents('audit-filter-other', 2);

      const byAction = await audit.list(t.organization.id, { action: 'agent.disabled' }, { limit: 10 });
      expect(byAction.map((e) => e.action)).toEqual(['agent.disabled', 'agent.disabled']);

      const byWorkspace = await audit.list(t.organization.id, { workspaceId: t.workspace.id }, { limit: 10 });
      expect(byWorkspace).toHaveLength(2);

      const crossTenantWorkspace = await audit.list(
        t.organization.id,
        { workspaceId: other.workspace.id },
        { limit: 10 },
      );
      expect(crossTenantWorkspace).toEqual([]);

      const byActor = await audit.list(t.organization.id, { actorPrincipalId: other.principal.id }, { limit: 10 });
      expect(byActor).toEqual([]);
    });

    it('treats hostile filter text as data, never as SQL', async () => {
      const t = await seedEvents('audit-sqli', 1);
      const result = await audit.list(t.organization.id, { action: "x' OR '1'='1" }, { limit: 10 });
      expect(result).toEqual([]);
      expect(await audit.list(t.organization.id, {}, { limit: 10 })).toHaveLength(1);
    });
  });
});
