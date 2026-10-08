import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestDatabase, type TestDatabase } from '../../../infrastructure/database/__fixtures__/test-database.js';
import { PrincipalRepository } from '../../identity/infrastructure/principal.repository.js';
import { OrganizationRepository } from '../../organizations/infrastructure/organization.repository.js';
import { WorkspaceRepository } from '../../workspaces/infrastructure/workspace.repository.js';
import { ToolPolicyRepository } from './tool-policy.repository.js';

describe('tool policies on real Postgres (integration)', () => {
  let database: TestDatabase;
  let policies: ToolPolicyRepository;
  let principals: PrincipalRepository;
  let organizations: OrganizationRepository;
  let workspaces: WorkspaceRepository;

  beforeAll(async () => {
    database = await createTestDatabase();
    policies = new ToolPolicyRepository(database.db);
    principals = new PrincipalRepository(database.db);
    organizations = new OrganizationRepository(database.db);
    workspaces = new WorkspaceRepository(database.db);
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

  const input = (t: Awaited<ReturnType<typeof tenant>>, toolName: string, rule: 'blocked' | 'approval_required') => ({
    organizationId: t.organization.id,
    workspaceId: t.workspace.id,
    toolName,
    rule,
    updatedByPrincipalId: t.principal.id,
  });

  it('creates a rule and finds it by tool', async () => {
    const t = await tenant('tp-create');
    const created = await policies.upsert(input(t, 'create_note', 'approval_required'));
    expect(created).toMatchObject({ toolName: 'create_note', rule: 'approval_required', workspaceId: t.workspace.id });
    expect((await policies.findByTool(t.workspace.id, 'create_note'))?.id).toBe(created.id);
    expect(await policies.findByTool(t.workspace.id, 'get_current_time')).toBeUndefined();
  });

  it('replaces the rule of the same tool instead of adding a second one', async () => {
    const t = await tenant('tp-replace');
    const first = await policies.upsert(input(t, 'create_note', 'approval_required'));
    const second = await policies.upsert({ ...input(t, 'create_note', 'blocked'), updatedByPrincipalId: t.principal.id });
    expect(second.id).toBe(first.id);
    expect(second.rule).toBe('blocked');
    expect(second.updatedAt.getTime()).toBeGreaterThanOrEqual(first.updatedAt.getTime());
    expect(await policies.listByWorkspace(t.workspace.id)).toHaveLength(1);
  });

  it('lists the rules of a workspace ordered by tool, and only those', async () => {
    const a = await tenant('tp-list-a');
    const b = await tenant('tp-list-b');
    await policies.upsert(input(a, 'search_knowledge', 'blocked'));
    await policies.upsert(input(a, 'create_note', 'approval_required'));
    await policies.upsert(input(b, 'create_note', 'blocked'));
    expect((await policies.listByWorkspace(a.workspace.id)).map((p) => p.toolName)).toEqual(['create_note', 'search_knowledge']);
    expect((await policies.listByWorkspace(b.workspace.id)).map((p) => p.rule)).toEqual(['blocked']);
  });

  it('removes a rule only inside its workspace', async () => {
    const a = await tenant('tp-rm-a');
    const b = await tenant('tp-rm-b');
    await policies.upsert(input(a, 'create_note', 'blocked'));
    expect(await policies.remove(b.workspace.id, 'create_note')).toBe(false);
    expect(await policies.findByTool(a.workspace.id, 'create_note')).toBeDefined();
    expect(await policies.remove(a.workspace.id, 'create_note')).toBe(true);
    expect(await policies.remove(a.workspace.id, 'create_note')).toBe(false);
  });

  it('refuses a rule the database does not know', async () => {
    const t = await tenant('tp-enum');
    await expect(policies.upsert({ ...input(t, 'create_note', 'blocked'), rule: 'allow_everything' as never })).rejects.toThrow();
  });
});
