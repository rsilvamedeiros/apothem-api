import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { loadEnv } from '../http/env.js';
import { postgresOptions } from './client.js';

async function main(): Promise<void> {
  const env = loadEnv();
  const queryClient = postgres(env.DATABASE_URL, postgresOptions(env, 1));
  const db = drizzle(queryClient);

  await migrate(db, { migrationsFolder: 'migrations' });
  await queryClient.end();
}

main().catch((error: unknown) => {
  console.error('Migration failed:', error);
  process.exit(1);
});
