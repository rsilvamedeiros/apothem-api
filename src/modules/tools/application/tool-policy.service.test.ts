import { beforeEach, describe, expect, it } from 'vitest';
import { AuthorizationService } from '../../authorization/application/authorization.service.js';
import { contextFor, ORG, WORKSPACE } from '../../runs/application/__fixtures__/run-kit.js';
import { FakeAuditLog } from '../../../infrastructure/http/__fixtures__/fake-repositories.js';
import { ForbiddenError, InvalidInputError, NotFoundError } from '../../../common/errors.js';
import { FakeToolPolicyRepository } from './__fixtures__/fake-tool-policy-repository.js';
import { ToolPolicyService } from './tool-policy.service.js';

const OTHER_WORKSPACE = '99999999-9999-4999-8999-999999999999';
const owner = contextFor('owner', 'owner');
const admin = contextFor('admin', 'admin');

describe('ToolPolicyService (ADR-015)', () => {
  let policies: FakeToolPolicyRepository;
  let audit: FakeAuditLog;
  let service: ToolPolicyService;

  beforeEach(() => {
    policies = new FakeToolPolicyRepository();
    audit = new FakeAuditLog();
    service = new ToolPolicyService(policies, new AuthorizationService(), audit);
  });

  const auditOf = (action: string) => audit.events.filter((e) => e.action === action);

  describe('who may do what', () => {
    it.each(['builder', 'operator', 'auditor'] as const)('denies %s every change', async (role) => {
      const ctx = contextFor(role, role);
      await expect(service.set(ctx, 'create_note', 'blocked')).rejects.toThrow(ForbiddenError);
      await service.set(owner, 'create_note', 'blocked');
      await expect(service.remove(ctx, 'create_note')).rejects.toThrow(ForbiddenError);
      expect(policies.rows).toHaveLength(1);
      expect(policies.rows[0]!.rule).toBe('blocked');
    });

    it.each(['owner', 'admin', 'builder', 'operator', 'auditor'] as const)('lets %s read the rules, so nobody is surprised by a missing tool', async (role) => {
      await service.set(owner, 'create_note', 'blocked');
      await expect(service.list(contextFor(role, role))).resolves.toHaveLength(1);
    });

    it('requires a workspace scope', async () => {
      const unscoped = contextFor('owner', 'owner', null);
      const message = 'Tool policies require a resolved workspace scope';
      await expect(service.list(unscoped)).rejects.toThrow(message);
      await expect(service.set(unscoped, 'create_note', 'blocked')).rejects.toThrow(message);
      await expect(service.remove(unscoped, 'create_note')).rejects.toThrow(message);
    });
  });

  describe('setting a rule', () => {
    it('stores the rule for the caller workspace and audits it with the tool and the previous rule', async () => {
      const result = await service.set(admin, 'create_note', 'approval_required');
      expect(result.changed).toBe(true);
      expect(result.policy).toMatchObject({
        organizationId: ORG,
        workspaceId: WORKSPACE,
        toolName: 'create_note',
        rule: 'approval_required',
        updatedByPrincipalId: admin.principal.id,
      });
      expect(auditOf('tool_policy.set')).toEqual([
        expect.objectContaining({
          organizationId: ORG,
          workspaceId: WORKSPACE,
          actorPrincipalId: admin.principal.id,
          targetType: 'tool_policy',
          targetId: result.policy.id,
          metadata: { tool: 'create_note', rule: 'approval_required', previousRule: null },
        }),
      ]);
    });

    it('replaces an existing rule and remembers what it replaced', async () => {
      await service.set(admin, 'create_note', 'approval_required');
      const result = await service.set(owner, 'create_note', 'blocked');
      expect(result.changed).toBe(true);
      expect(policies.rows).toHaveLength(1);
      expect(policies.rows[0]).toMatchObject({ rule: 'blocked', updatedByPrincipalId: owner.principal.id });
      expect(auditOf('tool_policy.set').at(-1)!.metadata).toEqual({ tool: 'create_note', rule: 'blocked', previousRule: 'approval_required' });
    });

    it('does nothing, and audits nothing, when the same rule is set again', async () => {
      await service.set(admin, 'create_note', 'blocked');
      const again = await service.set(owner, 'create_note', 'blocked');
      expect(again.changed).toBe(false);
      expect(auditOf('tool_policy.set')).toHaveLength(1);
      expect(policies.rows[0]!.updatedByPrincipalId).toBe(admin.principal.id);
    });

    it('only accepts tools that exist in the catalog, without echoing arbitrary input into a rule', async () => {
      await expect(service.set(admin, 'drop_database', 'blocked')).rejects.toThrow(NotFoundError);
      await expect(service.set(admin, 'toString', 'blocked')).rejects.toThrow(NotFoundError);
      await expect(service.set(admin, 'drop_database', 'blocked')).rejects.toThrow('Tool drop_database not found');
      expect(policies.rows).toHaveLength(0);
    });

    it('only accepts the known rules', async () => {
      await expect(service.set(admin, 'create_note', 'allow_everything' as never)).rejects.toThrow(InvalidInputError);
      await expect(service.set(admin, 'create_note', 'allow_everything' as never)).rejects.toThrow('Rule must be one of: blocked, approval_required');
      expect(policies.rows).toHaveLength(0);
    });

    it('can govern any catalog tool, including read-only ones', async () => {
      for (const tool of ['get_current_time', 'create_note', 'search_knowledge']) {
        await expect(service.set(admin, tool, 'approval_required')).resolves.toMatchObject({ changed: true });
      }
      expect(policies.rows.map((r) => r.toolName).sort()).toEqual(['create_note', 'get_current_time', 'search_knowledge']);
    });
  });

  describe('removing a rule', () => {
    it('removes it, audits it with what it was, and the tool is unrestricted again', async () => {
      const { policy } = await service.set(admin, 'create_note', 'blocked');
      expect(await service.remove(owner, 'create_note')).toBe(true);
      expect(policies.rows).toHaveLength(0);
      expect(auditOf('tool_policy.removed')).toEqual([
        expect.objectContaining({
          actorPrincipalId: owner.principal.id,
          targetType: 'tool_policy',
          targetId: policy.id,
          metadata: { tool: 'create_note', previousRule: 'blocked' },
        }),
      ]);
    });

    it('is a quiet no-op when there is no rule', async () => {
      expect(await service.remove(owner, 'create_note')).toBe(false);
      expect(auditOf('tool_policy.removed')).toHaveLength(0);
    });
  });

  describe('tenant isolation', () => {
    it('keeps rules inside their workspace', async () => {
      const elsewhere = contextFor('owner', 'owner', OTHER_WORKSPACE);
      await service.set(admin, 'create_note', 'blocked');

      expect(await service.list(elsewhere)).toEqual([]);
      expect(await service.remove(elsewhere, 'create_note')).toBe(false);
      await service.set(elsewhere, 'create_note', 'approval_required');
      expect((await service.list(admin)).map((p) => p.rule)).toEqual(['blocked']);
      expect((await service.list(elsewhere)).map((p) => p.rule)).toEqual(['approval_required']);
    });
  });

  it('lists the rules ordered by tool', async () => {
    await service.set(admin, 'search_knowledge', 'blocked');
    await service.set(admin, 'create_note', 'approval_required');
    expect((await service.list(admin)).map((p) => p.toolName)).toEqual(['create_note', 'search_knowledge']);
  });
});
