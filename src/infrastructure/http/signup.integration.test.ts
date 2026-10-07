import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SignJWT } from 'jose';
import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { buildServer } from './server.js';
import { loadEnv } from './env.js';
import { createTestDatabase, type TestDatabase } from '../database/__fixtures__/test-database.js';
import { principals } from '../../modules/identity/infrastructure/schema.js';

const ISSUER = 'https://auth.apothemai.com.br';
const AUDIENCE = 'apothem-api';
const SECRET = 'a-very-long-random-secret-of-at-least-32-chars';

const envFor = (jit: boolean) =>
  loadEnv({
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
    AUTH_JIT_PROVISIONING: jit ? 'true' : 'false',
  });

describe('sign-up by just-in-time provisioning (integration)', () => {
  let database: TestDatabase;
  let withSignUp: FastifyInstance;
  let withoutSignUp: FastifyInstance;

  beforeAll(async () => {
    database = await createTestDatabase();
    withSignUp = await buildServer(envFor(true), database.db);
    withoutSignUp = await buildServer(envFor(false), database.db);
    await Promise.all([withSignUp.ready(), withoutSignUp.ready()]);
  });

  afterAll(async () => {
    await Promise.all([withSignUp.close(), withoutSignUp.close()]);
    await database.close();
  });

  const token = (claims: Record<string, unknown>) =>
    new SignJWT({ email_verified: true, ...claims })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject('subject')
      .setIssuer(ISSUER)
      .setAudience(AUDIENCE)
      .setExpirationTime('5m')
      .sign(new TextEncoder().encode(SECRET));

  const createOrg = async (app: FastifyInstance, bearer: string, slug: string) =>
    app.inject({
      method: 'POST',
      url: '/v1/organizations',
      headers: { authorization: `Bearer ${bearer}` },
      payload: { name: slug, slug },
    });

  const accountsFor = async (email: string) =>
    database.db.select().from(principals).where(eq(principals.email, email));

  it('creates the account on the first verified login and lets it bootstrap an organization', async () => {
    const bearer = await token({ email: 'First.Login@Example.com', name: 'First Login' });
    const created = await createOrg(withSignUp, bearer, 'first-login-org');
    expect(created.statusCode).toBe(201);

    const accounts = await accountsFor('first.login@example.com');
    expect(accounts).toHaveLength(1);
    expect(accounts[0]).toMatchObject({ name: 'First Login', status: 'active', type: 'user' });
  });

  it('reuses the same account on later logins instead of creating duplicates', async () => {
    const bearer = await token({ email: 'repeat@example.com' });
    await createOrg(withSignUp, bearer, 'repeat-org-1');
    await createOrg(withSignUp, bearer, 'repeat-org-2');
    expect(await accountsFor('repeat@example.com')).toHaveLength(1);
  });

  it('survives simultaneous first logins with exactly one account', async () => {
    const bearer = await token({ email: 'concurrent@example.com' });
    const responses = await Promise.all(
      [1, 2, 3, 4].map((n) => createOrg(withSignUp, bearer, `concurrent-org-${n}`)),
    );
    expect(responses.every((r) => r.statusCode === 201)).toBe(true);
    expect(await accountsFor('concurrent@example.com')).toHaveLength(1);
  });

  it('gives a brand new account no access to anyone else organization', async () => {
    const owner = await token({ email: 'owner-of-org@example.com' });
    const org = (await createOrg(withSignUp, owner, 'private-org')).json();
    const stranger = await token({ email: 'stranger@example.com' });
    const response = await withSignUp.inject({
      method: 'GET',
      url: `/v1/organizations/${org.id}`,
      headers: { authorization: `Bearer ${stranger}` },
    });
    expect(response.statusCode).toBe(403);
  });

  it('does not create accounts for an unverified email', async () => {
    const bearer = await token({ email: 'unverified@example.com', email_verified: false });
    expect((await createOrg(withSignUp, bearer, 'unverified-org')).statusCode).toBe(401);
    expect(await accountsFor('unverified@example.com')).toHaveLength(0);
  });

  it('never resurrects a suspended account', async () => {
    const bearer = await token({ email: 'banned@example.com' });
    await createOrg(withSignUp, bearer, 'banned-org');
    await database.db.update(principals).set({ status: 'suspended' }).where(eq(principals.email, 'banned@example.com'));

    expect((await createOrg(withSignUp, bearer, 'banned-org-2')).statusCode).toBe(401);
    const [account] = await accountsFor('banned@example.com');
    expect(account?.status).toBe('suspended');
  });

  it('keeps sign-up closed when the feature flag is off', async () => {
    const bearer = await token({ email: 'closed@example.com' });
    expect((await createOrg(withoutSignUp, bearer, 'closed-org')).statusCode).toBe(401);
    expect(await accountsFor('closed@example.com')).toHaveLength(0);
  });
});
