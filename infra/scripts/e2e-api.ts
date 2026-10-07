import { buildServer } from '../../src/infrastructure/http/server.js';
import { loadEnv } from '../../src/infrastructure/http/env.js';
import { createTestDatabase } from '../../src/infrastructure/database/__fixtures__/test-database.js';

/**
 * Throwaway API for end-to-end tests of the web app: real routes, real
 * services and real migrations on an in-memory Postgres (PGlite), the mock
 * model, signed-token authentication and sign-up on first login. It needs no
 * Docker, no secrets and no network. Never use it outside tests.
 *
 *   npm run e2e:api            (listens on 127.0.0.1:3001)
 */
export const E2E_AUTH = {
  secret: 'e2e-only-secret-e2e-only-secret-0123456789',
  issuer: 'https://e2e.apothem.test',
  audience: 'apothem-api',
} as const;

async function main(): Promise<void> {
  const port = Number(process.env.E2E_API_PORT ?? 3001);
  const env = loadEnv({
    NODE_ENV: 'test',
    DATABASE_URL: 'postgres://unused/unused',
    REDIS_URL: 'redis://unused',
    STORAGE_ENDPOINT: 'http://unused',
    STORAGE_ACCESS_KEY_ID: 'unused',
    STORAGE_SECRET_ACCESS_KEY: 'unused',
    STORAGE_BUCKET: 'unused',
    AUTH_SECRET: E2E_AUTH.secret,
    AUTH_MODE: 'jwt',
    AUTH_JWT_ISSUER: E2E_AUTH.issuer,
    AUTH_JWT_AUDIENCE: E2E_AUTH.audience,
    AUTH_JIT_PROVISIONING: 'true',
  });

  const database = await createTestDatabase();
  const app = await buildServer(env, database.db);
  await app.listen({ port, host: '127.0.0.1' });
  console.log(`e2e api ready on http://127.0.0.1:${port}`);

  const shutdown = async (): Promise<void> => {
    await app.close();
    await database.close();
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown());
  process.on('SIGTERM', () => void shutdown());
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
