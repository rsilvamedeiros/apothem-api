import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import type { Database } from '../client.js';
import * as schema from '../schema.js';

export interface TestDatabase {
  /**
   * Typed as the production `Database`: the repositories only use the
   * query-builder API shared by every Drizzle Postgres driver, so the same
   * repository code runs unchanged against PGlite (real Postgres compiled to
   * WASM) with the committed migrations applied.
   */
  readonly db: Database;
  readonly close: () => Promise<void>;
}

/**
 * Fresh in-memory Postgres with every committed migration applied. No Docker,
 * no network, no cost, so integration tests run identically on a laptop and in
 * CI. A new instance per test file keeps suites isolated.
 */
export async function createTestDatabase(): Promise<TestDatabase> {
  const client = new PGlite();
  const pgliteDb = drizzle(client, { schema });
  await migrate(pgliteDb, { migrationsFolder: 'migrations' });
  return {
    db: pgliteDb as unknown as Database,
    close: () => client.close(),
  };
}
