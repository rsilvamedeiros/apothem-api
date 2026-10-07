import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildHttpTestApp } from '../../../../infrastructure/http/__fixtures__/http-test-harness.js';
import type { FakePrincipalRepository } from '../../../../infrastructure/http/__fixtures__/fake-repositories.js';
import { listToolNames } from '../../domain/tool-catalog.js';

describe('GET /v1/tools', () => {
  let app: FastifyInstance;
  let principals: FakePrincipalRepository;

  beforeEach(async () => {
    ({ app, principals } = await buildHttpTestApp());
  });

  afterEach(async () => {
    await app.close();
  });

  it('requires authentication', async () => {
    const response = await app.inject({ method: 'GET', url: '/v1/tools' });
    expect(response.statusCode).toBe(401);
  });

  it('lists every catalog tool with its risk and what a binding may choose', async () => {
    const account = await principals.create({ type: 'user', email: 'a@example.com', name: 'A' });
    const response = await app.inject({ method: 'GET', url: '/v1/tools', headers: { 'x-principal-id': account.id } });
    expect(response.statusCode).toBe(200);
    const { tools } = response.json() as { tools: { name: string; risk: string; description: string; allowedApprovalModes: string[] }[] };
    expect(tools.map((t) => t.name).sort()).toEqual(listToolNames().sort());
    expect(tools.find((t) => t.name === 'create_note')).toMatchObject({
      risk: 'reversible_write',
      allowedApprovalModes: ['required', 'auto'],
    });
    expect(tools.find((t) => t.name === 'get_current_time')).toMatchObject({ risk: 'read_only' });
  });

  it('exposes no handler, schema internals or secrets', async () => {
    const account = await principals.create({ type: 'user', email: 'b@example.com', name: 'B' });
    const response = await app.inject({ method: 'GET', url: '/v1/tools', headers: { 'x-principal-id': account.id } });
    for (const tool of response.json().tools) {
      expect(Object.keys(tool).sort()).toEqual(['allowedApprovalModes', 'description', 'name', 'risk']);
    }
  });
});
