import postgres from 'postgres';
import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from './schema.js';

export type Database = PostgresJsDatabase<typeof schema>;

export function createDatabaseClient(databaseUrl: string): { db: Database; close: () => Promise<void> } {
  const queryClient = postgres(databaseUrl);
  const db = drizzle(queryClient, { schema });
  return { db, close: () => queryClient.end() };
}
