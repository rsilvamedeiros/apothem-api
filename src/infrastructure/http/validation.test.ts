import Fastify from 'fastify';
import { describe, expect, it } from 'vitest';
import { requestValidatorCompiler } from './validation.js';

async function buildApp() {
  const app = Fastify();
  app.setValidatorCompiler(requestValidatorCompiler);
  app.post(
    '/echo/:id',
    {
      schema: {
        params: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
        querystring: { type: 'object', properties: { limit: { type: 'integer' } } },
        body: {
          type: 'object',
          properties: { text: { type: 'string' }, count: { type: 'integer' }, flag: { type: 'boolean' } },
          required: ['text'],
          additionalProperties: false,
        },
      },
    },
    async (request) => ({ query: request.query, body: request.body }),
  );
  await app.ready();
  return app;
}

const post = (app: Awaited<ReturnType<typeof buildApp>>, payload: unknown, query = '') =>
  app.inject({ method: 'POST', url: `/echo/abc${query}`, payload: payload as object });

describe('requestValidatorCompiler', () => {
  it('rejects a body value of the wrong type instead of coercing it', async () => {
    const app = await buildApp();
    expect((await post(app, { text: 5 })).statusCode).toBe(400);
    expect((await post(app, { text: true })).statusCode).toBe(400);
    expect((await post(app, { text: 'ok', count: '3' })).statusCode).toBe(400);
    expect((await post(app, { text: 'ok', flag: 'true' })).statusCode).toBe(400);
    expect((await post(app, { text: ['a', 'b'] })).statusCode).toBe(400);
    await app.close();
  });

  it('accepts a correctly typed body', async () => {
    const app = await buildApp();
    const response = await post(app, { text: 'ok', count: 3, flag: false });
    expect(response.statusCode).toBe(200);
    expect(response.json().body).toEqual({ text: 'ok', count: 3, flag: false });
    await app.close();
  });

  it('still strips unknown body fields when the schema forbids them', async () => {
    const app = await buildApp();
    const response = await post(app, { text: 'ok', tools: ['x'], organizationId: 'evil' });
    expect(response.json().body).toEqual({ text: 'ok' });
    await app.close();
  });

  it('keeps coercing query strings, which are always text on the wire', async () => {
    const app = await buildApp();
    const response = await post(app, { text: 'ok' }, '?limit=25');
    expect(response.json().query).toEqual({ limit: 25 });
    await app.close();
  });

  it('rejects a query value that is not a number', async () => {
    const app = await buildApp();
    expect((await post(app, { text: 'ok' }, '?limit=abc')).statusCode).toBe(400);
    await app.close();
  });
});
