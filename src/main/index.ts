import { loadEnv } from '../infrastructure/http/env.js';
import { buildServer } from '../infrastructure/http/server.js';
import { createDatabaseClient } from '../infrastructure/database/client.js';

const env = loadEnv();
const { db, close } = createDatabaseClient(env.DATABASE_URL);

const app = await buildServer(env, db);

async function shutdown(): Promise<void> {
  await app.close();
  await close();
}

process.on('SIGTERM', () => void shutdown().then(() => process.exit(0)));
process.on('SIGINT', () => void shutdown().then(() => process.exit(0)));

app
  .listen({ port: env.PORT, host: '0.0.0.0' })
  .then((address) => {
    app.log.info(`apothem-api listening on ${address}`);
  })
  .catch((error: unknown) => {
    app.log.error(error);
    process.exit(1);
  });
