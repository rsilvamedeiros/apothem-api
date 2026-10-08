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
      await service.updateDraft(builder, agent.id, { guardrails: { maxOutputTokens: 300 } });
      const changed = await service.publish(admin, agent.id);

      expect(same.checksum).toBe(first.checksum);
      expect(changed.checksum).not.toBe(first.checksum);
    });

    it('computes the checksum independently of JSON key order', async () => {
      const { agent } = await service.create(builder, { name: 'A', slug: 'a' });
      await service.updateDraft(builder, agent.id, {
        instructions: 'x',
        modelPolicy: { qualityTier: 'standard', allowedProviders: ['mock', 'other'], maxCostPerRunUsd: 1 },
      });
      const first = await service.publish(admin, agent.id);
      await service.updateDraft(builder, agent.id, {
        modelPolicy: { maxCostPerRunUsd: 1, allowedProviders: ['mock', 'other'], qualityTier: 'standard' },
      });
      const second = await service.publish(admin, agent.id);

      expect(second.checksum).toBe(first.checksum);
    });

    it('rejects a draft whose model policy or guardrails are not valid, naming the field', async () => {
      const { agent } = await service.create(builder, { name: 'A', slug: 'a' });
      await service.updateDraft(builder, agent.id, { instructions: 'x', modelPolicy: { qualityTier: 'ultra' } });
      await expect(service.publish(admin, agent.id)).rejects.toThrow(/Invalid model policy: qualityTier/);

      await service.updateDraft(builder, agent.id, { modelPolicy: {}, guardrails: { maxOutputToken: 10 } });
      await expect(service.publish(admin, agent.id)).rejects.toThrow(/Invalid guardrails: .*maxOutputToken/);

      await service.updateDraft(builder, agent.id, { guardrails: { timeoutMs: 999_999 } });
      await expect(service.publish(admin, agent.id)).rejects.toThrow(InvalidInputError);
      expect(await versions.findLatestVersionNumber(agent.id)).toBe(0);
    });

    it('rejects tool bindings that name unknown tools or break the contract, without echoing the name', async () => {
      const { agent } = await service.create(builder, { name: 'A', slug: 'a' });
      await service.updateDraft(builder, agent.id, { instructions: 'x', toolBindings: [{ tool: 'drop_database_xyz', approval: 'auto' }] });
      const error = await service.publish(admin, agent.id).catch((e: Error) => e);
      expect(error).toBeInstanceOf(InvalidInputError);
      expect((error as Error).message).toMatch(/Invalid tool bindings/);
      expect((error as Error).message).not.toContain('drop_database_xyz');

      await service.updateDraft(builder, agent.id, { toolBindings: [{ tool: 'create_note' }] });
      await expect(service.publish(admin, agent.id)).rejects.toThrow(/Invalid tool bindings/);
    });

    it('rejects knowledge bindings that break the contract, without echoing the value', async () => {
      const { agent } = await service.create(builder, { name: 'A', slug: 'a' });
      await service.updateDraft(builder, agent.id, { instructions: 'x', knowledgeBindings: [{ knowledgeBaseId: 'every-base' }] });
      const error = await service.publish(admin, agent.id).catch((e: Error) => e);
      expect(error).toBeInstanceOf(InvalidInputError);
      expect((error as Error).message).toMatch(/Invalid knowledge bindings/);
      expect((error as Error).message).not.toContain('every-base');

      const id = '11111111-1111-4111-8111-111111111111';
      await service.updateDraft(builder, agent.id, { knowledgeBindings: [{ knowledgeBaseId: id }, { knowledgeBaseId: id }] });
      await expect(service.publish(admin, agent.id)).rejects.toThrow(/duplicate knowledge base/);
      expect(await versions.findLatestVersionNumber(agent.id)).toBe(0);
    });

    it('publishes a draft whose knowledge bindings are valid', async () => {
      const { agent } = await service.create(builder, { name: 'A', slug: 'a' });
      await service.updateDraft(builder, agent.id, {
        instructions: 'x',
        knowledgeBindings: [{ knowledgeBaseId: '11111111-1111-4111-8111-111111111111' }],
      });
      await expect(service.publish(admin, agent.id)).resolves.toMatchObject({ versionNumber: 1 });
    });

    it('publishes a draft whose tool bindings are valid', async () => {
      const { agent } = await service.create(builder, { name: 'A', slug: 'a' });
      await service.updateDraft(builder, agent.id, {
        instructions: 'x',
        toolBindings: [
          { tool: 'get_current_time', approval: 'auto' },
          { tool: 'create_note', approval: 'required' },
        ],
      });
      await expect(service.publish(admin, agent.id)).resolves.toMatchObject({ versionNumber: 1 });
    });

    it('publishes a draft with a valid model policy and guardrails', async () => {
      const { agent } = await service.create(builder, { name: 'A', slug: 'a' });
      await service.updateDraft(builder, agent.id, {
        instructions: 'x',
        modelPolicy: { qualityTier: 'standard', allowedProviders: ['mock'], maxCostPerRunUsd: 1 },
        guardrails: { maxOutputTokens: 500, timeoutMs: 10_000 },
      });
      await expect(service.publish(admin, agent.id)).resolves.toMatchObject({ versionNumber: 1 });
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

  describe('error messages', () => {
    it('explains each refusal so clients can act on it', async () => {
      const { agent } = await service.create(builder, { name: 'A', slug: 'a' });
      const missing = '00000000-0000-4000-8000-000000000000';

      await expect(service.list(contextFor('owner', null))).rejects.toThrow('Agents require a resolved workspace scope');
      await expect(service.create(builder, { name: 'B', slug: 'a' })).rejects.toThrow(
        'Agent slug "a" is already in use in this workspace',
      );
      await expect(service.get(builder, missing)).rejects.toThrow(`Agent ${missing} not found`);
      await expect(service.publish(admin, agent.id)).rejects.toThrow(
        'Cannot publish an agent draft with empty instructions',
      );
      await expect(service.getVersion(admin, agent.id, missing)).rejects.toThrow(
        `Version ${missing} not found for agent ${agent.id}`,
      );

      await service.setLifecycleStatus(admin, agent.id, 'archived');
      await expect(service.updateDraft(builder, agent.id, { instructions: 'x' })).rejects.toThrow(
        'Cannot edit the draft of an archived agent',
      );
      await expect(service.publish(admin, agent.id)).rejects.toThrow('Cannot publish an archived agent');
      await expect(service.setLifecycleStatus(admin, agent.id, 'disabled')).rejects.toThrow(
        'Archived agents are terminal and cannot change status',
      );
    });
  });
});
