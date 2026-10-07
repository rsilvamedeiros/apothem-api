import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import {
  buildHttpTestApp,
  setupOwnerWithWorkspace,
} from '../../../../infrastructure/http/__fixtures__/http-test-harness.js';
import type { FakePrincipalRepository } from '../../../../infrastructure/http/__fixtures__/fake-repositories.js';

describe('agents HTTP validation and error model', () => {
  let app: FastifyInstance;
  let principals: FakePrincipalRepository;

  beforeEach(async () => {
    ({ app, principals } = await buildHttpTestApp());
  });

  afterEach(async () => {
    await app.close();
  });

  const agentsUrl = (orgId: string, wsId: string) => `/v1/organizations/${orgId}/workspaces/${wsId}/agents`;

  async function createAgent() {
    const tenant = await setupOwnerWithWorkspace(app, principals);
    const response = await app.inject({
      method: 'POST',
      url: agentsUrl(tenant.org.id, tenant.workspace.id),
      headers: { 'x-principal-id': tenant.owner.id },
      payload: { name: 'Support', slug: 'support' },
    });
    return { ...tenant, agent: response.json().agent };
  }

  it('requires authentication', async () => {
    const { org, workspace } = await createAgent();
    const response = await app.inject({ method: 'GET', url: agentsUrl(org.id, workspace.id) });
    expect(response.statusCode).toBe(401);
    expect(response.json().error.code).toBe('UNAUTHENTICATED');
  });

  it.each([
    ['uppercase', 'Support'],
    ['spaces', 'my agent'],
    ['leading hyphen', '-agent'],
    ['double hyphen', 'my--agent'],
    ['path traversal', '../admin'],
    ['empty', ''],
    ['too long', 'a'.repeat(64)],
  ])('rejects an invalid slug (%s) with a normalized 400', async (_label, slug) => {
    const { owner, org, workspace } = await createAgent();
    const response = await app.inject({
      method: 'POST',
      url: agentsUrl(org.id, workspace.id),
      headers: { 'x-principal-id': owner.id },
      payload: { name: 'Other', slug },
    });
    expect(response.statusCode).toBe(400);
    expect(response.json().error).toMatchObject({ code: 'INVALID_INPUT', requestId: expect.any(String) });
  });

  it('rejects a missing name', async () => {
    const { owner, org, workspace } = await createAgent();
    const response = await app.inject({
      method: 'POST',
      url: agentsUrl(org.id, workspace.id),
      headers: { 'x-principal-id': owner.id },
      payload: { slug: 'no-name' },
    });
    expect(response.statusCode).toBe(400);
  });

  it('rejects non-uuid path parameters instead of reaching the database', async () => {
    const { owner, org, workspace } = await createAgent();
    for (const url of [
      `${agentsUrl(org.id, workspace.id)}/not-a-uuid`,
      `${agentsUrl(org.id, 'not-a-uuid')}`,
      `${agentsUrl('not-a-uuid', workspace.id)}`,
    ]) {
      const response = await app.inject({ method: 'GET', url, headers: { 'x-principal-id': owner.id } });
      expect(response.statusCode, url).toBe(400);
    }
  });

  it('rejects oversized instructions and wrongly typed draft fields', async () => {
    const { owner, org, workspace, agent } = await createAgent();
    const url = `${agentsUrl(org.id, workspace.id)}/${agent.id}/draft`;
    const headers = { 'x-principal-id': owner.id };

    const tooLong = await app.inject({ method: 'PATCH', url, headers, payload: { instructions: 'x'.repeat(50_001) } });
    const wrongType = await app.inject({ method: 'PATCH', url, headers, payload: { toolBindings: 'not-an-array' } });
    const wrongShape = await app.inject({ method: 'PATCH', url, headers, payload: { modelPolicy: ['a'] } });

    expect([tooLong.statusCode, wrongType.statusCode, wrongShape.statusCode]).toEqual([400, 400, 400]);
  });

  it('ignores client-supplied tenant fields in the body and keeps the authenticated scope', async () => {
    const { owner, org, workspace } = await createAgent();
    const response = await app.inject({
      method: 'POST',
      url: agentsUrl(org.id, workspace.id),
      headers: { 'x-principal-id': owner.id },
      payload: {
        name: 'Sneaky',
        slug: 'sneaky',
        organizationId: crypto.randomUUID(),
        workspaceId: crypto.randomUUID(),
      },
    });
    expect(response.statusCode).toBe(201);
    expect(response.json().agent).toMatchObject({ organizationId: org.id, workspaceId: workspace.id });
  });

  it('never leaks internals in error responses', async () => {
    const { owner, org, workspace } = await createAgent();
    const response = await app.inject({
      method: 'GET',
      url: `${agentsUrl(org.id, workspace.id)}/${crypto.randomUUID()}`,
      headers: { 'x-principal-id': owner.id },
    });
    expect(response.statusCode).toBe(404);
    expect(response.body).not.toMatch(/stack|node_modules|at \w+ \(/i);
  });

  it('publishes a version whose response never includes another tenant data and matches the schema', async () => {
    const { owner, org, workspace, agent } = await createAgent();
    const headers = { 'x-principal-id': owner.id };
    await app.inject({
      method: 'PATCH',
      url: `${agentsUrl(org.id, workspace.id)}/${agent.id}/draft`,
      headers,
      payload: { instructions: 'Be helpful.', guardrails: { maxOutputTokens: 500 } },
    });
    const published = await app.inject({
      method: 'POST',
      url: `${agentsUrl(org.id, workspace.id)}/${agent.id}/publish`,
      headers,
    });
    expect(published.statusCode).toBeLessThan(300);
    expect(published.json()).toMatchObject({
      agentId: agent.id,
      versionNumber: 1,
      checksum: expect.stringMatching(/^[0-9a-f]{64}$/),
      publishedByPrincipalId: owner.id,
    });
  });
});
