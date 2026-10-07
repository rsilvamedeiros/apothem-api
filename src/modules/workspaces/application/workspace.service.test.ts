import { beforeEach, describe, expect, it } from 'vitest';
import { WorkspaceService } from './workspace.service.js';
import { AuthorizationService } from '../../authorization/application/authorization.service.js';
import type { TenantContext } from '../../authorization/application/tenant-context.js';
import type { OrganizationRole } from '../../authorization/domain/role.js';
import { ConflictError, ForbiddenError, NotFoundError } from '../../../common/errors.js';
import { FakeAuditLog, FakeWorkspaceRepository } from '../../../infrastructure/http/__fixtures__/fake-repositories.js';

const contextFor = (role: OrganizationRole, organizationId = 'org-1'): TenantContext => ({
  principal: { id: `principal-${role}`, type: 'user', email: `${role}@example.com`, name: role },
  organizationId,
  organizationRole: role,
});

describe('WorkspaceService', () => {
  let audit: FakeAuditLog;
  let service: WorkspaceService;

  beforeEach(() => {
    audit = new FakeAuditLog();
    service = new WorkspaceService(new FakeWorkspaceRepository(), new AuthorizationService(), audit);
  });

  it.each(['owner', 'admin'] as const)('lets %s create workspaces and audits it', async (role) => {
    const workspace = await service.create(contextFor(role), { name: 'Ops', slug: 'ops' });
    expect(workspace).toMatchObject({ organizationId: 'org-1', slug: 'ops' });
    expect(audit.events).toEqual([
      expect.objectContaining({
        action: 'workspace.created',
        organizationId: 'org-1',
        workspaceId: workspace.id,
        actorPrincipalId: `principal-${role}`,
        metadata: { slug: 'ops' },
      }),
    ]);
  });

  it.each(['builder', 'operator', 'auditor'] as const)(
    'denies %s creating workspaces, with no side effects',
    async (role) => {
      await expect(service.create(contextFor(role), { name: 'Ops', slug: 'ops' })).rejects.toThrow(ForbiddenError);
      expect(audit.events).toHaveLength(0);
      await expect(service.list(contextFor('owner'))).resolves.toEqual([]);
    },
  );

  it('rejects a duplicate slug inside an organization but allows it in another', async () => {
    await service.create(contextFor('owner'), { name: 'Ops', slug: 'ops' });
    await expect(service.create(contextFor('owner'), { name: 'Again', slug: 'ops' })).rejects.toThrow(ConflictError);
    await expect(service.create(contextFor('owner', 'org-2'), { name: 'Ops', slug: 'ops' })).resolves.toBeDefined();
  });

  it('lists only the workspaces of the caller organization', async () => {
    await service.create(contextFor('owner'), { name: 'A', slug: 'a' });
    await service.create(contextFor('owner', 'org-2'), { name: 'B', slug: 'b' });
    const listed = await service.list(contextFor('operator'));
    expect(listed.map((workspace) => workspace.slug)).toEqual(['a']);
  });

  it('does not return a workspace of another organization by id (looks like not found)', async () => {
    const foreign = await service.create(contextFor('owner', 'org-2'), { name: 'B', slug: 'b' });
    await expect(service.get(contextFor('owner'), foreign.id)).rejects.toThrow(NotFoundError);
    await expect(service.get(contextFor('owner', 'org-2'), foreign.id)).resolves.toMatchObject({ id: foreign.id });
  });

  it('denies reading to a forged role', async () => {
    await expect(service.list(contextFor('constructor' as never))).rejects.toThrow(ForbiddenError);
  });
});
