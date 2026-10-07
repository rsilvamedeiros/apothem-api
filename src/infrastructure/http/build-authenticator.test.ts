import { SignJWT } from 'jose';
import { describe, expect, it } from 'vitest';
import { buildAuthenticator } from './build-authenticator.js';
import { loadEnv } from './env.js';
import { DevHeaderAuthenticator } from '../../modules/identity/infrastructure/dev-header-authenticator.js';
import { JwtAuthenticator } from '../../modules/identity/infrastructure/jwt-authenticator.js';
import type { PrincipalReaderPort } from '../../modules/identity/application/principal-reader.port.js';
import type { AuthenticatedPrincipal } from '../../modules/identity/application/principal.js';

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
