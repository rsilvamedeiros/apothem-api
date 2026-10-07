import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SignJWT } from 'jose';
import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { buildServer } from './server.js';
import { loadEnv } from './env.js';
import { createTestDatabase, type TestDatabase } from '../database/__fixtures__/test-database.js';
import { PrincipalRepository } from '../../modules/identity/infrastructure/principal.repository.js';
import { principals } from '../../modules/identity/infrastructure/schema.js';

const ISSUER = 'https://auth.apothemai.com.br';
const AUDIENCE = 'apothem-api';
const SECRET = 'a-very-long-random-secret-of-at-least-32-chars';

const env = loadEnv({
  NODE_ENV: 'test',
  DATABASE_URL: 'postgres://unused/unused',
  REDIS_URL: 'redis://unused',
  STORAGE_ENDPOINT: 'http://unused',
  STORAGE_ACCESS_KEY_ID: 'unused',
  STORAGE_SECRET_ACCESS_KEY: 'unused',
  STORAGE_BUCKET: 'unused',
  AUTH_SECRET: SECRET,
  AUTH_MODE: 'jwt',
  AUTH_JWT_ISSUER: ISSUER,
  AUTH_JWT_AUDIENCE: AUDIENCE,
});

/** Whole stack in jwt mode: bearer verification, principal lookup on real Postgres, tenant resolution. */
describe('bearer authentication (integration)', () => {
  let database: TestDatabase;
  let app: FastifyInstance;
  let repository: PrincipalRepository;

  beforeAll(async () => {
    database = await createTestDatabase();
    app = await buildServer(env, database.db);
    await app.ready();
    repository = new PrincipalRepository(database.db);
  });

  afterAll(async () => {
    await app.close();
    await database.close();
  });

  const token = (claims: Record<string, unknown>, options: { secret?: string; audience?: string; expiresIn?: string } = {}) =>
    new SignJWT({ email_verified: true, ...claims })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject('subject')
      .setIssuer(ISSUER)
      .setAudience(options.audience ?? AUDIENCE)
      .setExpirationTime(options.expiresIn ?? '5m')
      .sign(new TextEncoder().encode(options.secret ?? SECRET));

  const get = (path: string, headers: Record<string, string>) => app.inject({ method: 'GET', url: path, headers });

  async function account(label: string) {
    return repository.create({ type: 'user', email: `${label}@example.com`, name: label });
  }

  async function createOrganization(bearer: string, slug: string) {
    const response = await app.inject({
      method: 'POST',
      url: '/v1/organizations',
      headers: { authorization: `Bearer ${bearer}` },
      payload: { name: slug, slug },
    });
    return response;
  }

  it('lets a valid token act as its account, resolved by verified email', async () => {
    const alice = await account('alice');
    const bearer = await token({ email: alice.email });

    const created = await createOrganization(bearer, 'alice-org');
    expect(created.statusCode).toBe(201);
    const organization = created.json();

    const read = await get(`/v1/organizations/${organization.id}`, { authorization: `Bearer ${bearer}` });
    expect(read.statusCode).toBe(200);

    const members = await get(`/v1/organizations/${organization.id}/members`, { authorization: `Bearer ${bearer}` });
    expect(members.json()[0]).toMatchObject({ principalId: alice.id, role: 'owner' });
  });

  it('ignores the dev header entirely: a victim id is not a credential in jwt mode', async () => {
    const victim = await account('victim');
    const bearer = await token({ email: victim.email });
    const org = (await createOrganization(bearer, 'victim-org')).json();

    const impersonation = await get(`/v1/organizations/${org.id}`, { 'x-principal-id': victim.id });
    expect(impersonation.statusCode).toBe(401);

    // Even next to a valid token for somebody else, the header changes nothing.
    const attacker = await account('attacker');
    const attackerBearer = await token({ email: attacker.email });
    const mixed = await get(`/v1/organizations/${org.id}`, {
      authorization: `Bearer ${attackerBearer}`,
      'x-principal-id': victim.id,
    });
    expect(mixed.statusCode).toBe(403);
  });

  it.each([
    ['no credential', async () => ({})],
    ['an expired token', async () => ({ authorization: `Bearer ${await token({ email: 'alice@example.com' }, { expiresIn: '-1h' })}` })],
    ['a wrong audience', async () => ({ authorization: `Bearer ${await token({ email: 'alice@example.com' }, { audience: 'other' })}` })],
    ['a wrong secret', async () => ({ authorization: `Bearer ${await token({ email: 'alice@example.com' }, { secret: 'x'.repeat(40) })}` })],
    ['an unverified email', async () => ({ authorization: `Bearer ${await token({ email: 'alice@example.com', email_verified: false })}` })],
    ['an unknown account', async () => ({ authorization: `Bearer ${await token({ email: 'nobody@example.com' })}` })],
    ['a non-bearer scheme', async () => ({ authorization: `Basic ${Buffer.from('a:b').toString('base64')}` })],
    ['garbage', async () => ({ authorization: 'Bearer not.a.token' })],
  ])('answers 401 for %s', async (_label, headers) => {
    const response = await get('/v1/organizations/00000000-0000-4000-8000-000000000000', await headers());
    expect(response.statusCode).toBe(401);
    expect(response.json().error.code).toBe('UNAUTHENTICATED');
    expect(response.body).not.toMatch(/signature|expired|audience|issuer/i);
  });

  it('stops honoring tokens of a suspended account immediately', async () => {
    const carol = await account('carol');
    const bearer = await token({ email: carol.email });
    const org = (await createOrganization(bearer, 'carol-org')).json();
    expect((await get(`/v1/organizations/${org.id}`, { authorization: `Bearer ${bearer}` })).statusCode).toBe(200);

    await database.db.update(principals).set({ status: 'suspended' }).where(eq(principals.id, carol.id));
    expect((await get(`/v1/organizations/${org.id}`, { authorization: `Bearer ${bearer}` })).statusCode).toBe(401);
  });

  it('matches the account email regardless of case in the token', async () => {
    const dave = await account('dave');
    const bearer = await token({ email: 'DAVE@Example.COM' });
    expect((await createOrganization(bearer, 'dave-org')).statusCode).toBe(201);
    expect(dave.id).toBeDefined();
  });
});
