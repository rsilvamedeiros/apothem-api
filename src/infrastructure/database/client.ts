import postgres from 'postgres';
import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from './schema.js';

export type Database = PostgresJsDatabase<typeof schema>;

export interface DatabaseConnectionSettings {
  readonly DATABASE_POOL_MAX: number;
  readonly DATABASE_PREPARED_STATEMENTS: boolean;
}

/**
 * Driver options derived from configuration. `narrowTo` lets a short-lived job
 * (the migration) use fewer connections than the server, never more.
 */
export function postgresOptions(settings: DatabaseConnectionSettings, narrowTo?: number): { max: number; prepare: boolean } {
  const max = narrowTo === undefined ? settings.DATABASE_POOL_MAX : Math.min(narrowTo, settings.DATABASE_POOL_MAX);
  return { max, prepare: settings.DATABASE_PREPARED_STATEMENTS };
}

export function createDatabaseClient(
  databaseUrl: string,
  settings: DatabaseConnectionSettings = { DATABASE_POOL_MAX: 10, DATABASE_PREPARED_STATEMENTS: true },
): { db: Database; close: () => Promise<void> } {
  const queryClient = postgres(databaseUrl, postgresOptions(settings));
  const db = drizzle(queryClient, { schema });
  return { db, close: () => queryClient.end() };
}
