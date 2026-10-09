import { describe, expect, it } from 'vitest';
import { loadEnv } from './env.js';

const validEnv = {
  DATABASE_URL: 'postgres://apothem:apothem@localhost:5432/apothem',
  REDIS_URL: 'redis://localhost:6379',
  STORAGE_ENDPOINT: 'http://localhost:9000',
  STORAGE_ACCESS_KEY_ID: 'apothem',
  STORAGE_SECRET_ACCESS_KEY: 'apothem123',
  STORAGE_BUCKET: 'apothem-dev',
  AUTH_SECRET: 'test-secret',
};

/** What production needs today: a database and signed-token authentication. Nothing else is read yet. */
const minimalProduction = {
  NODE_ENV: 'production',
  DATABASE_URL: 'postgres://user:pass@db.example.com:6543/postgres?sslmode=require',
  AUTH_SECRET: 'a-very-long-random-secret-of-at-least-32-chars',
  AUTH_MODE: 'jwt',
  AUTH_JWT_ISSUER: 'https://auth.apothemai.com.br',
  AUTH_JWT_AUDIENCE: 'apothem-api',
};

describe('loadEnv', () => {
  it('parses a valid environment and applies defaults', () => {
    const env = loadEnv(validEnv);
    expect(env.PORT).toBe(3001);
    expect(env.NODE_ENV).toBe('development');
  });

  it('throws with a descriptive message when required config is missing', () => {
    const { DATABASE_URL: _omit, ...incomplete } = validEnv;
    expect(() => loadEnv(incomplete)).toThrow(/DATABASE_URL/);
  });

  describe('services nothing reads yet', () => {
    it('does not demand Redis or object storage, so production needs no placeholder values', () => {
      const env = loadEnv(minimalProduction);
      expect(env.REDIS_URL).toBeUndefined();
      expect(env.STORAGE_ENDPOINT).toBeUndefined();
      expect(env.STORAGE_BUCKET).toBeUndefined();
    });

    it('still validates them when they are given', () => {
      expect(() => loadEnv({ ...minimalProduction, REDIS_URL: 'not a url' })).toThrow(/REDIS_URL/);
      expect(() => loadEnv({ ...minimalProduction, STORAGE_ENDPOINT: 'nope' })).toThrow(/STORAGE_ENDPOINT/);
      expect(() => loadEnv({ ...minimalProduction, STORAGE_BUCKET: '' })).toThrow(/STORAGE_BUCKET/);
    });

    it('keeps accepting the full local configuration', () => {
      expect(loadEnv(validEnv).REDIS_URL).toBe('redis://localhost:6379');
    });
  });

  describe('database connection', () => {
    it('defaults to a small pool with prepared statements', () => {
      const env = loadEnv(minimalProduction);
      expect(env.DATABASE_POOL_MAX).toBe(10);
      expect(env.DATABASE_PREPARED_STATEMENTS).toBe(true);
    });

    it('accepts a pool size from 1 to 50', () => {
      expect(loadEnv({ ...minimalProduction, DATABASE_POOL_MAX: '1' }).DATABASE_POOL_MAX).toBe(1);
      expect(loadEnv({ ...minimalProduction, DATABASE_POOL_MAX: '50' }).DATABASE_POOL_MAX).toBe(50);
    });

    it.each(['0', '-1', '51', '2.5', 'many', ''])('rejects a pool size of %j', (value) => {
      expect(() => loadEnv({ ...minimalProduction, DATABASE_POOL_MAX: value })).toThrow(/DATABASE_POOL_MAX/);
    });

    it('lets prepared statements be turned off for a transaction pooler such as Supabase', () => {
      expect(loadEnv({ ...minimalProduction, DATABASE_PREPARED_STATEMENTS: 'false' }).DATABASE_PREPARED_STATEMENTS).toBe(false);
      expect(loadEnv({ ...minimalProduction, DATABASE_PREPARED_STATEMENTS: 'true' }).DATABASE_PREPARED_STATEMENTS).toBe(true);
    });

    it.each(['0', 'no', 'FALSE', ''])('rejects %j instead of guessing what it meant', (value) => {
      expect(() => loadEnv({ ...minimalProduction, DATABASE_PREPARED_STATEMENTS: value })).toThrow(/DATABASE_PREPARED_STATEMENTS/);
    });
  });

  describe('production', () => {
    it('boots with only a database and signed-token authentication', () => {
      expect(loadEnv(minimalProduction)).toMatchObject({ NODE_ENV: 'production', AUTH_MODE: 'jwt' });
    });

    it('refuses the dev header authenticator, however the rest is configured', () => {
      expect(() => loadEnv({ ...minimalProduction, AUTH_MODE: 'dev' })).toThrow(/AUTH_MODE/);
    });

    it('refuses a missing database, a short shared secret and a missing issuer or audience', () => {
      const { DATABASE_URL: _db, ...withoutDatabase } = minimalProduction;
      expect(() => loadEnv(withoutDatabase)).toThrow(/DATABASE_URL/);
      expect(() => loadEnv({ ...minimalProduction, AUTH_SECRET: 'too-short' })).toThrow(/AUTH_SECRET/);
      const { AUTH_JWT_ISSUER: _iss, ...withoutIssuer } = minimalProduction;
      expect(() => loadEnv(withoutIssuer)).toThrow(/AUTH_JWT_ISSUER/);
      const { AUTH_JWT_AUDIENCE: _aud, ...withoutAudience } = minimalProduction;
      expect(() => loadEnv(withoutAudience)).toThrow(/AUTH_JWT_AUDIENCE/);
    });
  });
});
