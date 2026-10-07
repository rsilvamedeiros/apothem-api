import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import {
  buildHttpTestApp,
  setupOwnerWithWorkspace,
} from '../../../../infrastructure/http/__fixtures__/http-test-harness.js';
import type { FakePrincipalRepository } from '../../../../infrastructure/http/__fixtures__/fake-repositories.js';

describe('GET /v1/me', () => {
  let app: FastifyInstance;
  let principals: FakePrincipalRepository;

  beforeEach(async () => {
    ({ app, principals } = await buildHttpTestApp());
  });

  afterEach(async () => {
    await app.close();
  });

  it('requires authentication', async () => {
    const response = await app.inject({ method: 'GET', url: '/v1/me' });
    expect(response.statusCode).toBe(401);
    expect(response.json().error.code).toBe('UNAUTHENTICATED');
  });

  it('is empty for an account that belongs to nothing yet', async () => {
    const account = await principals.create({ type: 'user', email: 'new@example.com', name: 'New' });
    const response = await app.inject({ method: 'GET', url: '/v1/me', headers: { 'x-principal-id': account.id } });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      principal: { id: account.id, email: 'new@example.com', name: 'New' },
      organizations: [],
    });
  });

  it('lists only the caller organizations with their role', async () => {
    const mine = await setupOwnerWithWorkspace(app, principals);
    const theirs = await setupOwnerWithWorkspace(app, principals);

    const response = await app.inject({ method: 'GET', url: '/v1/me', headers: { 'x-principal-id': mine.owner.id } });
    const body = response.json();
    expect(body.organizations).toEqual([
      expect.objectContaining({ id: mine.org.id, role: 'owner' }),
    ]);
    expect(JSON.stringify(body)).not.toContain(theirs.org.id);
  });

  it('does not expose other personal data', async () => {
    const mine = await setupOwnerWithWorkspace(app, principals);
    const response = await app.inject({ method: 'GET', url: '/v1/me', headers: { 'x-principal-id': mine.owner.id } });
    expect(Object.keys(response.json().principal).sort()).toEqual(['email', 'id', 'name']);
  });
});
