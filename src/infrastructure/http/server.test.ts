import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildServer } from './server.js';
import { loadEnv } from './env.js';
import type { Database } from '../database/client.js';

const env = loadEnv({
  NODE_ENV: 'test',
  DATABASE_URL: 'postgres://unused/unused',
  REDIS_URL: 'redis://unused',
  STORAGE_ENDPOINT: 'http://unused',
  STORAGE_ACCESS_KEY_ID: 'unused',
  STORAGE_SECRET_ACCESS_KEY: 'unused',
  STORAGE_BUCKET: 'unused',
  AUTH_SECRET: 'unused-secret-value',
});

describe('server correlation and error shape', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    // /ready is the only handler that touches `db`; not exercised here.
    app = await buildServer(env, {} as Database);
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
  });

  it('echoes the request id as an x-request-id response header', async () => {
    const response = await app.inject({ method: 'GET', url: '/health' });
    expect(response.statusCode).toBe(200);
    expect(response.headers['x-request-id']).toBeTruthy();
  });

  it('includes the same request id in a normalized error body', async () => {
    const response = await app.inject({ method: 'GET', url: '/v1/organizations/not-a-uuid' });
    expect(response.statusCode).toBe(400);
    const body = response.json();
    expect(body.error.requestId).toBe(response.headers['x-request-id']);
  });

  it('serves the OpenAPI document', async () => {
    const response = await app.inject({ method: 'GET', url: '/v1/openapi.json' });
    expect(response.statusCode).toBe(200);
    expect(response.json().info.title).toBe('APOTHEM API');
  });
});
