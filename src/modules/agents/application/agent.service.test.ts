import { beforeEach, describe, expect, it } from 'vitest';
import { AgentService } from './agent.service.js';
import { AuthorizationService } from '../../authorization/application/authorization.service.js';
import type { TenantContext } from '../../authorization/application/tenant-context.js';
import type { OrganizationRole } from '../../authorization/domain/role.js';
import { ConflictError, ForbiddenError, InvalidInputError, NotFoundError } from '../../../common/errors.js';
import {
  FakeAgentDraftRepository,
  FakeAgentRepository,
  FakeAgentVersionRepository,
  FakeAuditLog,
} from '../../../infrastructure/http/__fixtures__/fake-repositories.js';

const ORG = 'org-1';
const WORKSPACE = 'workspace-1';
const OTHER_WORKSPACE = 'workspace-2';

function contextFor(role: OrganizationRole, workspaceId: string | null = WORKSPACE): TenantContext {
  return {
    principal: { id: `principal-${role}`, type: 'user', email: `${role}@example.com`, name: role },
    organizationId: ORG,
    organizationRole: role,
    ...(workspaceId ? { workspaceId } : {}),
  };
}

describe('AgentService', () => {
  let audit: FakeAuditLog;
  let versions: FakeAgentVersionRepository;
  let service: AgentService;

  beforeEach(() => {
    audit = new FakeAuditLog();
    versions = new FakeAgentVersionRepository();
    service = new AgentService(
      new FakeAgentRepository(),
      new FakeAgentDraftRepository(),
      versions,
      new AuthorizationService(),
      audit,
    );
  });

  const builder = contextFor('builder');
  const admin = contextFor('admin');

  async function publishedAgent() {
    const { agent } = await service.create(builder, { name: 'Support', slug: 'support' });
    await service.updateDraft(builder, agent.id, { instructions: 'Answer politely.' });
    const version = await service.publish(admin, agent.id);
    return { agent, version };
  }

  describe('authorization and scope', () => {
    it('refuses to operate without a workspace scope', async () => {
      await expect(service.list(contextFor('owner', null))).rejects.toThrow(ForbiddenError);
    });

    it('lets a builder draft but not publish', async () => {
      const { agent } = await service.create(builder, { name: 'A', slug: 'a' });
      await service.updateDraft(builder, agent.id, { instructions: 'x' });
      await expect(service.publish(builder, agent.id)).rejects.toThrow(ForbiddenError);
    });

    it('lets an auditor read but not create', async () => {
      const auditor = contextFor('auditor');
      await expect(service.list(auditor)).resolves.toEqual([]);
      await expect(service.create(auditor, { name: 'A', slug: 'a' })).rejects.toThrow(ForbiddenError);
    });

    it('does not expose agents of another workspace (get, update, publish, versions)', async () => {
      const { agent, version } = await publishedAgent();
      const foreign = contextFor('owner', OTHER_WORKSPACE);

      await expect(service.get(foreign, agent.id)).rejects.toThrow(NotFoundError);
      await expect(service.updateDraft(foreign, agent.id, { instructions: 'x' })).rejects.toThrow(NotFoundError);
      await expect(service.publish(foreign, agent.id)).rejects.toThrow(NotFoundError);
      await expect(service.listVersions(foreign, agent.id)).rejects.toThrow(NotFoundError);
      await expect(service.getVersion(foreign, agent.id, version.id)).rejects.toThrow(NotFoundError);
      await expect(service.setLifecycleStatus(foreign, agent.id, 'disabled')).rejects.toThrow(NotFoundError);
      await expect(service.list(foreign)).resolves.toEqual([]);
    });

    it('allows the same slug in different workspaces but not twice in one', async () => {
      await service.create(builder, { name: 'A', slug: 'same' });
      await expect(service.create(builder, { name: 'B', slug: 'same' })).rejects.toThrow(ConflictError);
      await expect(
        service.create(contextFor('builder', OTHER_WORKSPACE), { name: 'C', slug: 'same' }),
      ).resolves.toBeDefined();
    });
  });

  describe('publishing', () => {
    it.each(['', '   ', '\n\t'])('rejects blank instructions (%j)', async (instructions) => {
      const { agent } = await service.create(builder, { name: 'A', slug: 'a' });
      await service.updateDraft(builder, agent.id, { instructions });
      await expect(service.publish(admin, agent.id)).rejects.toThrow(InvalidInputError);
    });

    it('numbers versions sequentially and points the agent at the latest', async () => {
      const { agent, version: first } = await publishedAgent();
      await service.updateDraft(builder, agent.id, { instructions: 'Answer briefly.' });
      const second = await service.publish(admin, agent.id);

      expect([first.versionNumber, second.versionNumber]).toEqual([1, 2]);
      expect((await service.get(admin, agent.id)).agent.activeVersionId).toBe(second.id);
    });

    it('snapshots the draft so later draft edits never change a published version', async () => {
      const { agent, version } = await publishedAgent();
      await service.updateDraft(builder, agent.id, { instructions: 'Changed after publish.' });

      const stored = await service.getVersion(admin, agent.id, version.id);
      expect(stored.instructions).toBe('Answer politely.');
      expect(stored.checksum).toBe(version.checksum);
    });

    it('gives identical snapshots the same checksum and different ones a different checksum', async () => {
      const { agent, version: first } = await publishedAgent();
      const same = await service.publish(admin, agent.id);
      await service.updateDraft(builder, agent.id, { guardrails: { maxSteps: 3 } });
      const changed = await service.publish(admin, agent.id);

      expect(same.checksum).toBe(first.checksum);
      expect(changed.checksum).not.toBe(first.checksum);
    });

    it('computes the checksum independently of JSON key order', async () => {
      const { agent } = await service.create(builder, { name: 'A', slug: 'a' });
      await service.updateDraft(builder, agent.id, {
        instructions: 'x',
        modelPolicy: { primary: 'm1', fallback: ['m2'], limits: { a: 1, b: 2 } },
      });
      const first = await service.publish(admin, agent.id);
      await service.updateDraft(builder, agent.id, {
        modelPolicy: { limits: { b: 2, a: 1 }, fallback: ['m2'], primary: 'm1' },
      });
      const second = await service.publish(admin, agent.id);

      expect(second.checksum).toBe(first.checksum);
    });

    it('records who published which version in the audit trail', async () => {
      const { agent, version } = await publishedAgent();
      const event = audit.events.find((e) => e.action === 'agent.version_published');
      expect(event).toMatchObject({
        organizationId: ORG,
        workspaceId: WORKSPACE,
        actorPrincipalId: admin.principal.id,
        targetId: version.id,
        metadata: { agentId: agent.id, versionNumber: 1, checksum: version.checksum },
      });
    });
  });

  describe('lifecycle', () => {
    it('keeps archived as a terminal state', async () => {
      const { agent } = await publishedAgent();
      await service.setLifecycleStatus(admin, agent.id, 'archived');

      await expect(service.setLifecycleStatus(admin, agent.id, 'disabled')).rejects.toThrow(ConflictError);
      await expect(service.publish(admin, agent.id)).rejects.toThrow(ConflictError);
      expect((await service.get(admin, agent.id)).agent.status).toBe('archived');
    });

    it('emits an audit event for every state-changing operation', async () => {
      const { agent } = await publishedAgent();
      await service.setLifecycleStatus(admin, agent.id, 'disabled');
      await service.setLifecycleStatus(admin, agent.id, 'archived');

      expect(audit.events.map((e) => e.action)).toEqual([
        'agent.created',
        'agent.draft_updated',
        'agent.version_published',
        'agent.disabled',
        'agent.archived',
      ]);
    });

    it('never audits or mutates anything for a denied operation', async () => {
      const { agent } = await service.create(builder, { name: 'A', slug: 'a' });
      const before = audit.events.length;
      await expect(service.setLifecycleStatus(builder, agent.id, 'disabled')).rejects.toThrow(ForbiddenError);
      expect(audit.events).toHaveLength(before);
      expect((await service.get(builder, agent.id)).agent.status).toBe('draft');
    });
  });

  describe('version immutability', () => {
    it('exposes no update or delete operation on the version port', () => {
      const operations = Object.getOwnPropertyNames(Object.getPrototypeOf(versions)).filter(
        (name) => name !== 'constructor',
      );
      expect(operations.filter((name) => /^(update|delete|remove|save|upsert)/i.test(name))).toEqual([]);
    });
  });
});
