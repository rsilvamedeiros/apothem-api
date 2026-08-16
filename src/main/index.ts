import { loadEnv } from '../infrastructure/http/env.js';
import { buildServer } from '../infrastructure/http/server.js';

const env = loadEnv();
const app = buildServer(env);

app
  .listen({ port: env.PORT, host: '0.0.0.0' })
  .then((address) => {
    app.log.info(`apothem-api listening on ${address}`);
  })
  .catch((error) => {
    app.log.error(error);
    process.exit(1);
  });
