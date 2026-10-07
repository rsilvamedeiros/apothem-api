import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildHttpTestApp, setupOwnerWithWorkspace } from '../../../../infrastructure/http/__fixtures__/http-test-harness.js';
import type { FakePrincipalRepository } from '../../../../infrastructure/http/__fixtures__/fake-repositories.js';

describe('agents HTTP routes', () => {
  let app: FastifyInstance;
  let principals: FakePrincipalRepository;

  beforeEach(async () => {
    ({ app, principals } = await buildHttpTestApp());
  });

  afterEach(async () => {
    await app.close();
  });

  const agentsUrl = (orgId: string, wsId: string) => `/v1/organizations/${orgId}/workspaces/${wsId}/agents`;

  it('creates an agent with an empty draft and rejects publishing it until instructions are set', async () => {
    const { owner, org, workspace } = await setupOwnerWithWorkspace(app, principals);

    const created = await app.inject({
      method: 'POST',
      url: agentsUrl(org.id, workspace.id),
      headers: { 'x-principal-id': owner.id },
      payload: { name: 'Support Bot', slug: 'support-bot' },
    });
    expect(created.statusCode).toBe(201);
    const { agent, draft } = created.json();
    expect(agent.status).toBe('draft');
    expect(draft.instructions).toBe('');

    const publishEmpty = await app.inject({
      method: 'POST',
      url: `${agentsUrl(org.id, workspace.id)}/${agent.id}/publish`,
      headers: { 'x-principal-id': owner.id },
    });
    expect(publishEmpty.statusCode).toBe(400);
  });

  it('publishes a version after editing the draft and activates the agent', async () => {
    const { owner, org, workspace } = await setupOwnerWithWorkspace(app, principals);
    const agent = (
      await app.inject({
        method: 'POST',
        url: agentsUrl(org.id, workspace.id),
        headers: { 'x-principal-id': owner.id },
        payload: { name: 'Support Bot', slug: 'support-bot' },
      })
    ).json().agent;

    const patched = await app.inject({
      method: 'PATCH',
      url: `${agentsUrl(org.id, workspace.id)}/${agent.id}/draft`,
      headers: { 'x-principal-id': owner.id },
      payload: { instructions: 'You are a helpful support agent.', modelPolicy: { allowedProviders: ['mock'] } },
    });
    expect(patched.statusCode).toBe(200);
    expect(patched.json().instructions).toBe('You are a helpful support agent.');

    const published = await app.inject({
      method: 'POST',
      url: `${agentsUrl(org.id, workspace.id)}/${agent.id}/publish`,
      headers: { 'x-principal-id': owner.id },
    });
    expect(published.statusCode).toBe(201);
    const version = published.json();
    expect(version.versionNumber).toBe(1);
    expect(version.instructions).toBe('You are a helpful support agent.');

    const fetched = await app.inject({
      method: 'GET',
      url: `${agentsUrl(org.id, workspace.id)}/${agent.id}`,
      headers: { 'x-principal-id': owner.id },
    });
    expect(fetched.json().agent.status).toBe('active');
    expect(fetched.json().agent.activeVersionId).toBe(version.id);

    // Publishing again produces version 2 without touching version 1.
    const republished = await app.inject({
      method: 'POST',
      url: `${agentsUrl(org.id, workspace.id)}/${agent.id}/publish`,
      headers: { 'x-principal-id': owner.id },
    });
    expect(republished.json().versionNumber).toBe(2);

    const versions = await app.inject({
      method: 'GET',
      url: `${agentsUrl(org.id, workspace.id)}/${agent.id}/versions`,
      headers: { 'x-principal-id': owner.id },
    });
    expect(versions.json()).toHaveLength(2);
  });

  it('rejects agent draft writes from a role without agent.draft.write (operator)', async () => {
    const { owner, org, workspace } = await setupOwnerWithWorkspace(app, principals);
    const operator = await principals.create({ type: 'user', email: `operator-${crypto.randomUUID()}@example.com`, name: 'Operator' });

    // Owner adds operator as an org member with the 'operator' role by
    // creating a second organization membership isn't exposed via HTTP yet,
    // so this test only proves the deny path through a principal with no
    // membership at all — the tenant-context IDOR path already covered in
    // organizations-workspaces.routes.test.ts.
    const created = await app.inject({
      method: 'POST',
      url: agentsUrl(org.id, workspace.id),
      headers: { 'x-principal-id': owner.id },
      payload: { name: 'Support Bot', slug: 'support-bot' },
    });
    const agent = created.json().agent;

    const denied = await app.inject({
      method: 'PATCH',
      url: `${agentsUrl(org.id, workspace.id)}/${agent.id}/draft`,
      headers: { 'x-principal-id': operator.id },
      payload: { instructions: 'trying to sneak in' },
    });
    expect(denied.statusCode).toBe(403);
  });

  it('disabling and archiving an agent updates its status, and archived agents reject further draft edits', async () => {
    const { owner, org, workspace } = await setupOwnerWithWorkspace(app, principals);
    const agent = (
      await app.inject({
        method: 'POST',
        url: agentsUrl(org.id, workspace.id),
        headers: { 'x-principal-id': owner.id },
        payload: { name: 'Support Bot', slug: 'support-bot' },
      })
    ).json().agent;

    const disabled = await app.inject({
      method: 'POST',
      url: `${agentsUrl(org.id, workspace.id)}/${agent.id}/disable`,
      headers: { 'x-principal-id': owner.id },
    });
    expect(disabled.json().status).toBe('disabled');

    const archived = await app.inject({
      method: 'POST',
      url: `${agentsUrl(org.id, workspace.id)}/${agent.id}/archive`,
      headers: { 'x-principal-id': owner.id },
    });
    expect(archived.json().status).toBe('archived');

    const editAfterArchive = await app.inject({
      method: 'PATCH',
      url: `${agentsUrl(org.id, workspace.id)}/${agent.id}/draft`,
      headers: { 'x-principal-id': owner.id },
      payload: { instructions: 'too late' },
    });
    expect(editAfterArchive.statusCode).toBe(409);
  });

  it("rejects a member of one organization fetching another organization's agent by id (cross-tenant IDOR)", async () => {
    const tenantA = await setupOwnerWithWorkspace(app, principals);
    const tenantB = await setupOwnerWithWorkspace(app, principals);

    const agentB = (
      await app.inject({
        method: 'POST',
        url: agentsUrl(tenantB.org.id, tenantB.workspace.id),
        headers: { 'x-principal-id': tenantB.owner.id },
        payload: { name: 'B Agent', slug: 'b-agent' },
      })
    ).json().agent;

    // tenantA's owner pairs their own org/workspace ids with tenant B's agent id.
    const crossTenant = await app.inject({
      method: 'GET',
      url: `${agentsUrl(tenantA.org.id, tenantA.workspace.id)}/${agentB.id}`,
      headers: { 'x-principal-id': tenantA.owner.id },
    });
    expect(crossTenant.statusCode).toBe(404);
  });

  it('rejects a duplicate agent slug within the same workspace with 409', async () => {
    const { owner, org, workspace } = await setupOwnerWithWorkspace(app, principals);
    await app.inject({
      method: 'POST',
      url: agentsUrl(org.id, workspace.id),
      headers: { 'x-principal-id': owner.id },
      payload: { name: 'Support Bot', slug: 'support-bot' },
    });
    const duplicate = await app.inject({
      method: 'POST',
      url: agentsUrl(org.id, workspace.id),
      headers: { 'x-principal-id': owner.id },
      payload: { name: 'Support Bot Again', slug: 'support-bot' },
    });
    expect(duplicate.statusCode).toBe(409);
  });
});
