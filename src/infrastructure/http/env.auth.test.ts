import { describe, expect, it } from 'vitest';
import { loadEnv } from './env.js';

const base = {
  DATABASE_URL: 'postgres://apothem:apothem@localhost:5432/apothem',
  REDIS_URL: 'redis://localhost:6379',
  STORAGE_ENDPOINT: 'http://localhost:9000',
  STORAGE_ACCESS_KEY_ID: 'apothem',
  STORAGE_SECRET_ACCESS_KEY: 'apothem123',
  STORAGE_BUCKET: 'apothem-dev',
  AUTH_SECRET: 'test-secret',
};

const LONG_SECRET = 'a-very-long-random-secret-of-at-least-32-chars';

const jwtEnv = {
  ...base,
  AUTH_MODE: 'jwt',
  AUTH_SECRET: LONG_SECRET,
  AUTH_JWT_ISSUER: 'https://auth.apothemai.com.br',
  AUTH_JWT_AUDIENCE: 'apothem-api',
};

describe('auth configuration', () => {
  it('defaults to dev mode outside production', () => {
    expect(loadEnv(base).AUTH_MODE).toBe('dev');
    expect(loadEnv({ ...base, NODE_ENV: 'test' }).AUTH_MODE).toBe('dev');
  });

  it('refuses to boot in production with the dev header authenticator', () => {
    expect(() => loadEnv({ ...base, NODE_ENV: 'production' })).toThrow(/AUTH_MODE/);
    expect(() => loadEnv({ ...base, NODE_ENV: 'production', AUTH_MODE: 'dev' })).toThrow(/AUTH_MODE/);
  });

  it('accepts production with jwt mode', () => {
    expect(loadEnv({ ...jwtEnv, NODE_ENV: 'production' }).AUTH_MODE).toBe('jwt');
  });

  it('requires issuer and audience in jwt mode', () => {
    const { AUTH_JWT_ISSUER: _i, ...noIssuer } = jwtEnv;
    const { AUTH_JWT_AUDIENCE: _a, ...noAudience } = jwtEnv;
    expect(() => loadEnv(noIssuer)).toThrow(/AUTH_JWT_ISSUER/);
    expect(() => loadEnv(noAudience)).toThrow(/AUTH_JWT_AUDIENCE/);
  });

  it('requires a long shared secret unless a JWKS URL is configured', () => {
    expect(() => loadEnv({ ...jwtEnv, AUTH_SECRET: 'short' })).toThrow(/AUTH_SECRET/);
    expect(
      loadEnv({ ...jwtEnv, AUTH_SECRET: 'short', AUTH_JWKS_URL: 'https://auth.apothemai.com.br/.well-known/jwks.json' })
        .AUTH_JWKS_URL,
    ).toContain('jwks');
  });

  it('rejects an unknown mode and a non-URL JWKS', () => {
    expect(() => loadEnv({ ...base, AUTH_MODE: 'none' })).toThrow(/AUTH_MODE/);
    expect(() => loadEnv({ ...jwtEnv, AUTH_JWKS_URL: 'not a url' })).toThrow(/AUTH_JWKS_URL/);
  });
});
