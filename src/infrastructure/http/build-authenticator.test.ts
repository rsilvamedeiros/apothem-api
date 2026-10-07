import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { exportJWK, generateKeyPair, SignJWT } from 'jose';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildAuthenticator } from './build-authenticator.js';
import { loadEnv } from './env.js';
import { DevHeaderAuthenticator } from '../../modules/identity/infrastructure/dev-header-authenticator.js';
import { JwtAuthenticator } from '../../modules/identity/infrastructure/jwt-authenticator.js';
import type { PrincipalReaderPort } from '../../modules/identity/application/principal-reader.port.js';
import type { AuthenticatedPrincipal } from '../../modules/identity/application/principal.js';
import type { PrincipalProvisionerPort } from '../../modules/identity/application/principal-provisioner.js';

const base = {
  DATABASE_URL: 'postgres://u:p@localhost:5432/db',
  REDIS_URL: 'redis://localhost:6379',
  STORAGE_ENDPOINT: 'http://localhost:9000',
  STORAGE_ACCESS_KEY_ID: 'k',
  STORAGE_SECRET_ACCESS_KEY: 's',
  STORAGE_BUCKET: 'b',
  AUTH_SECRET: 'a-very-long-random-secret-of-at-least-32-chars',
};

const jwt = {
  ...base,
  AUTH_MODE: 'jwt',
  AUTH_JWT_ISSUER: 'https://auth.example.com',
  AUTH_JWT_AUDIENCE: 'apothem-api',
};

const USER: AuthenticatedPrincipal = { id: 'p1', type: 'user', email: 'u@example.com', name: 'U' };
const reader: PrincipalReaderPort = {
  findById: async () => USER,
  findByEmail: async (email) => (email === USER.email ? USER : undefined),
};

describe('buildAuthenticator', () => {
  it('uses the dev header authenticator in dev mode', () => {
    const authenticator = buildAuthenticator(loadEnv(base), reader);
    expect(authenticator).toBeInstanceOf(DevHeaderAuthenticator);
    expect(authenticator.credentialSource).toBe('x-principal-id');
  });

  it('uses the JWT authenticator reading bearer tokens in jwt mode', () => {
    const authenticator = buildAuthenticator(loadEnv(jwt), reader);
    expect(authenticator).toBeInstanceOf(JwtAuthenticator);
    expect(authenticator.credentialSource).toBe('bearer');
  });

  it('verifies HS256 tokens signed with AUTH_SECRET and rejects other secrets', async () => {
    const authenticator = buildAuthenticator(loadEnv(jwt), reader);
    const make = (secret: string) =>
      new SignJWT({ email: USER.email, email_verified: true })
        .setProtectedHeader({ alg: 'HS256' })
        .setSubject('s')
        .setIssuer(jwt.AUTH_JWT_ISSUER)
        .setAudience(jwt.AUTH_JWT_AUDIENCE)
        .setExpirationTime('5m')
        .sign(new TextEncoder().encode(secret));

    await expect(authenticator.authenticate(await make(jwt.AUTH_SECRET))).resolves.toEqual(USER);
    await expect(authenticator.authenticate(await make('some-other-secret-some-other-secret-xx'))).resolves.toBeNull();
  });

  it('builds a JWKS-backed authenticator without contacting the network at construction', () => {
    const authenticator = buildAuthenticator(
      loadEnv({ ...jwt, AUTH_JWKS_URL: 'https://auth.example.com/.well-known/jwks.json' }),
      reader,
    );
    expect(authenticator).toBeInstanceOf(JwtAuthenticator);
  });

  it('refuses to build a production authenticator that is not jwt', () => {
    expect(() => loadEnv({ ...base, NODE_ENV: 'production' })).toThrow(/AUTH_MODE/);
  });
});

const NEWCOMER = 'new@example.com';
const signHs256 = (claims: { issuer?: string; audience?: string; email?: string } = {}) =>
  new SignJWT({ email: claims.email ?? NEWCOMER, email_verified: true, name: 'New Person' })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject('s')
    .setIssuer(claims.issuer ?? jwt.AUTH_JWT_ISSUER)
    .setAudience(claims.audience ?? jwt.AUTH_JWT_AUDIENCE)
    .setExpirationTime('5m')
    .sign(new TextEncoder().encode(jwt.AUTH_SECRET));

describe('buildAuthenticator token binding', () => {
  it('rejects a token from another issuer or for another audience', async () => {
    const authenticator = buildAuthenticator(loadEnv(jwt), reader);
    await expect(authenticator.authenticate(await signHs256({ email: USER.email, issuer: 'https://evil.example.com' }))).resolves.toBeNull();
    await expect(authenticator.authenticate(await signHs256({ email: USER.email, audience: 'someone-else' }))).resolves.toBeNull();
    await expect(authenticator.authenticate(await signHs256({ email: USER.email }))).resolves.toEqual(USER);
  });

  it('refuses to build jwt mode without issuer and audience', () => {
    const env = loadEnv(jwt);
    expect(() => buildAuthenticator({ ...env, AUTH_JWT_ISSUER: undefined }, reader)).toThrow(/AUTH_JWT_ISSUER/);
    expect(() => buildAuthenticator({ ...env, AUTH_JWT_AUDIENCE: undefined }, reader)).toThrow(/AUTH_JWT_AUDIENCE/);
  });
});

describe('buildAuthenticator sign-up wiring', () => {
  const provisioned: AuthenticatedPrincipal = { id: 'p2', type: 'user', email: NEWCOMER, name: 'New Person' };
  const makeProvisioner = () => {
    const provision = vi.fn(async () => provisioned);
    const provisioner: PrincipalProvisionerPort = { provision };
    return { provision, provisioner };
  };

  it('creates the account of an unknown verified email only when sign-up is enabled', async () => {
    const { provision, provisioner } = makeProvisioner();
    const authenticator = buildAuthenticator(loadEnv({ ...jwt, AUTH_JIT_PROVISIONING: 'true' }), reader, provisioner);
    await expect(authenticator.authenticate(await signHs256())).resolves.toEqual(provisioned);
    expect(provision).toHaveBeenCalledWith({ email: NEWCOMER, name: 'New Person' });
  });

  it('admits existing accounts only when sign-up is disabled, even if a provisioner is given', async () => {
    const { provision, provisioner } = makeProvisioner();
    const authenticator = buildAuthenticator(loadEnv(jwt), reader, provisioner);
    await expect(authenticator.authenticate(await signHs256())).resolves.toBeNull();
    expect(provision).not.toHaveBeenCalled();
  });

  it('admits existing accounts only when sign-up is enabled but no provisioner exists', async () => {
    const authenticator = buildAuthenticator(loadEnv({ ...jwt, AUTH_JIT_PROVISIONING: 'true' }), reader);
    await expect(authenticator.authenticate(await signHs256())).resolves.toBeNull();
  });
});

describe('buildAuthenticator with a published key set', () => {
  let server: Server | undefined;
  afterEach(() => new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve())));

  async function serveKeys() {
    const { publicKey, privateKey } = await generateKeyPair('RS256');
    const jwk = { ...(await exportJWK(publicKey)), kid: 'k1', alg: 'RS256', use: 'sig' };
    server = createServer((_request, response) => {
      response.setHeader('content-type', 'application/json');
      response.end(JSON.stringify({ keys: [jwk] }));
    });
    await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', resolve));
    const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/jwks.json`;
    return { url, privateKey };
  }

  it('verifies RS256 tokens against the published keys and refuses the shared secret', async () => {
    const { url, privateKey } = await serveKeys();
    const authenticator = buildAuthenticator(loadEnv({ ...jwt, AUTH_JWKS_URL: url }), reader);
    const rs256 = await new SignJWT({ email: USER.email, email_verified: true })
      .setProtectedHeader({ alg: 'RS256', kid: 'k1' })
      .setSubject('s')
      .setIssuer(jwt.AUTH_JWT_ISSUER)
      .setAudience(jwt.AUTH_JWT_AUDIENCE)
      .setExpirationTime('5m')
      .sign(privateKey);

    await expect(authenticator.authenticate(rs256)).resolves.toEqual(USER);
    await expect(authenticator.authenticate(await signHs256({ email: USER.email }))).resolves.toBeNull();
  });
});
