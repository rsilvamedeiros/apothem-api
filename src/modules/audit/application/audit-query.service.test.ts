import { beforeEach, describe, expect, it } from 'vitest';
import { AuditQueryService, DEFAULT_AUDIT_PAGE_SIZE, MAX_AUDIT_PAGE_SIZE } from './audit-query.service.js';
import { AuthorizationService } from '../../authorization/application/authorization.service.js';
import type { TenantContext } from '../../authorization/application/tenant-context.js';
import type { OrganizationRole } from '../../authorization/domain/role.js';
import { ForbiddenError, InvalidInputError } from '../../../common/errors.js';
import { FakeAuditReader } from '../../../infrastructure/http/__fixtures__/fake-repositories.js';
import type { StoredAuditEvent } from './audit-reader.port.js';

const ORG = '11111111-1111-4111-8111-111111111111';
const OTHER_ORG = '99999999-9999-4999-8999-999999999999';
const WORKSPACE = '22222222-2222-4222-8222-222222222222';

const contextFor = (role: OrganizationRole, organizationId = ORG): TenantContext => ({
  principal: { id: `principal-${role}`, type: 'user', email: `${role}@example.com`, name: role },
  organizationId,
  organizationRole: role,
});

let counter = 0;
function event(overrides: Partial<StoredAuditEvent> = {}): StoredAuditEvent {
  counter += 1;
  return {
    id: crypto.randomUUID(),
    organizationId: ORG,
    workspaceId: null,
    actorPrincipalId: crypto.randomUUID(),
    action: 'agent.created',
    targetType: 'agent',
    targetId: crypto.randomUUID(),
    metadata: null,
    createdAt: new Date(Date.UTC(2026, 0, 1, 0, 0, counter)),
    ...overrides,
  };
}

describe('AuditQueryService', () => {
  let reader: FakeAuditReader;
  let service: AuditQueryService;

  beforeEach(() => {
    reader = new FakeAuditReader();
    service = new AuditQueryService(reader, new AuthorizationService());
  });

  describe('authorization', () => {
    it.each(['owner', 'admin', 'auditor'] as const)('lets %s read the audit log', async (role) => {
      reader.add(event());
      const page = await service.list(contextFor(role), {});
      expect(page.events).toHaveLength(1);
    });

    it.each(['builder', 'operator'] as const)('denies %s and never queries the store', async (role) => {
      await expect(service.list(contextFor(role), {})).rejects.toThrow(ForbiddenError);
      expect(reader.queries).toHaveLength(0);
    });
  });

  describe('tenant isolation', () => {
    it('returns only events of the caller organization', async () => {
      const mine = event();
      reader.add(mine);
      reader.add(event({ organizationId: OTHER_ORG }));

      const page = await service.list(contextFor('owner'), {});
      expect(page.events.map((e) => e.id)).toEqual([mine.id]);
      expect(reader.queries[0]?.organizationId).toBe(ORG);
    });

    it('never lets a workspace filter widen access to another organization', async () => {
      reader.add(event({ organizationId: OTHER_ORG, workspaceId: WORKSPACE }));
      const page = await service.list(contextFor('owner'), { workspaceId: WORKSPACE });
      expect(page.events).toEqual([]);
    });
  });

  describe('pagination', () => {
    it('orders newest first and pages with a cursor without gaps or repeats', async () => {
      const all = Array.from({ length: 5 }, () => event());
      all.forEach((e) => reader.add(e));
      const expected = [...all].reverse().map((e) => e.id);

      const first = await service.list(contextFor('owner'), { limit: 2 });
      expect(first.events.map((e) => e.id)).toEqual(expected.slice(0, 2));
      expect(first.nextCursor).toEqual(expect.any(String));

      const second = await service.list(contextFor('owner'), { limit: 2, cursor: first.nextCursor! });
      expect(second.events.map((e) => e.id)).toEqual(expected.slice(2, 4));

      const third = await service.list(contextFor('owner'), { limit: 2, cursor: second.nextCursor! });
      expect(third.events.map((e) => e.id)).toEqual(expected.slice(4));
      expect(third.nextCursor).toBeNull();
    });

    it('reports no next cursor when the page is exactly the last one', async () => {
      reader.add(event());
      reader.add(event());
      const page = await service.list(contextFor('owner'), { limit: 2 });
      expect(page.events).toHaveLength(2);
      expect(page.nextCursor).toBeNull();
    });

    it('breaks ties between equal timestamps by id so no event is skipped', async () => {
      const sameTime = new Date('2026-02-02T00:00:00.000Z');
      const events = [
        event({ id: '00000000-0000-4000-8000-000000000001', createdAt: sameTime }),
        event({ id: '00000000-0000-4000-8000-000000000002', createdAt: sameTime }),
        event({ id: '00000000-0000-4000-8000-000000000003', createdAt: sameTime }),
      ];
      events.forEach((e) => reader.add(e));

      const seen: string[] = [];
      let cursor: string | undefined;
      for (let guard = 0; guard < 5; guard += 1) {
        const page = await service.list(contextFor('owner'), { limit: 1, ...(cursor ? { cursor } : {}) });
        seen.push(...page.events.map((e) => e.id));
        if (!page.nextCursor) break;
        cursor = page.nextCursor;
      }
      expect(new Set(seen).size).toBe(3);
      expect(seen).toHaveLength(3);
    });

    it('uses the default page size and clamps the limit', async () => {
      await service.list(contextFor('owner'), {});
      await service.list(contextFor('owner'), { limit: 100_000 });
      await service.list(contextFor('owner'), { limit: 0 });
      await service.list(contextFor('owner'), { limit: -5 });
      await service.list(contextFor('owner'), { limit: 2.7 });

      // The store is asked for one extra row to detect a next page.
      expect(reader.queries.map((q) => q.page.limit)).toEqual([
        DEFAULT_AUDIT_PAGE_SIZE + 1,
        MAX_AUDIT_PAGE_SIZE + 1,
        2,
        2,
        3,
      ]);
    });

    it('rejects a malformed cursor before querying', async () => {
      await expect(service.list(contextFor('owner'), { cursor: 'garbage' })).rejects.toThrow(InvalidInputError);
      expect(reader.queries).toHaveLength(0);
    });
  });

  describe('filters', () => {
    it('filters by action and by workspace', async () => {
      reader.add(event({ action: 'agent.created', workspaceId: WORKSPACE }));
      reader.add(event({ action: 'agent.version_published', workspaceId: WORKSPACE }));
      reader.add(event({ action: 'agent.version_published', workspaceId: null }));

      const byAction = await service.list(contextFor('owner'), { action: 'agent.version_published' });
      expect(byAction.events).toHaveLength(2);
      const both = await service.list(contextFor('owner'), { action: 'agent.version_published', workspaceId: WORKSPACE });
      expect(both.events).toHaveLength(1);
    });
  });
});
