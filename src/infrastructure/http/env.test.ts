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
});
