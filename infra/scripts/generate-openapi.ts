import { writeFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildServer } from '../../src/infrastructure/http/server.js';
import { loadEnv } from '../../src/infrastructure/http/env.js';
import type { Database } from '../../src/infrastructure/database/client.js';

/**
 * Writes the live OpenAPI spec (same document served at GET /v1/openapi.json)
 * to openapi/openapi.json so apothem-ai/packages/api-client can generate
 * from a committed file without a running database. Route registration does
 * not execute queries, so a real DB connection is unnecessary here — only
 * calls the app never makes (e.g. the /ready handler) would need one.
 */
async function main(): Promise<void> {
  process.env.DATABASE_URL ??= 'postgres://unused/unused';
  const env = loadEnv();
  const unusedDb = {} as Database;
  const app = await buildServer(env, unusedDb);
  await app.ready();

  const outPath = fileURLToPath(new URL('../../openapi/openapi.json', import.meta.url));
  await mkdir(dirname(outPath), { recursive: true });
  await writeFile(outPath, JSON.stringify(app.swagger(), null, 2) + '\n', 'utf-8');

  await app.close();
  console.log(`OpenAPI spec written to ${outPath}`);
}

main().catch((error: unknown) => {
  console.error('Failed to generate OpenAPI spec:', error);
  process.exit(1);
});
