import type { FastifyInstance } from 'fastify';
import { buildServer } from '../server.js';
import { loadEnv } from '../env.js';
import type { Database } from '../../database/client.js';
import { buildTestServices } from './build-test-services.js';
import type { FakePrincipalRepository } from './fake-repositories.js';

export const testEnv = loadEnv({
  NODE_ENV: 'test',
  DATABASE_URL: 'postgres://unused/unused',
  REDIS_URL: 'redis://unused',
  STORAGE_ENDPOINT: 'http://unused',
  STORAGE_ACCESS_KEY_ID: 'unused',
  STORAGE_SECRET_ACCESS_KEY: 'unused',
  STORAGE_BUCKET: 'unused',
  AUTH_SECRET: 'unused-secret-value',
});

export interface HttpTestApp {
  app: FastifyInstance;
  principals: FakePrincipalRepository;
}

/** Builds the real Fastify server over in-memory fakes (no database). */
export async function buildHttpTestApp(): Promise<HttpTestApp> {
  const built = buildTestServices();
  const app = await buildServer(testEnv, {} as Database, built.services);
  await app.ready();
  return { app, principals: built.principals };
}

export async function setupOwnerWithWorkspace(app: FastifyInstance, principals: FakePrincipalRepository) {
  const owner = await principals.create({
    type: 'user',
    email: `owner-${crypto.randomUUID()}@example.com`,
    name: 'Owner',
  });
  const org = (
    await app.inject({
      method: 'POST',
      url: '/v1/organizations',
      headers: { 'x-principal-id': owner.id },
      payload: { name: 'Acme', slug: `acme-${crypto.randomUUID()}` },
    })
  ).json();
  const workspace = (
    await app.inject({
      method: 'POST',
      url: `/v1/organizations/${org.id}/workspaces`,
      headers: { 'x-principal-id': owner.id },
      payload: { name: 'Default', slug: 'default' },
    })
  ).json();
  return { owner, org, workspace };
}
