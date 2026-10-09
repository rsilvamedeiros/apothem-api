import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import net from 'node:net';

/**
 * Boots the BUILT server exactly as production does (`node dist/...`, no tsx,
 * NODE_ENV=production) and checks what must hold before anything is deployed:
 * it starts, answers, ignores the dev header, shuts down cleanly, and refuses
 * to start with unsafe or missing configuration. No database is needed: it
 * points at a port nobody listens on, which also proves the server survives
 * (and reports) a database that is down.
 *
 *   npm run build && npm run smoke:prod
 */
const ENTRY = 'dist/src/main/index.js';
const MIGRATE = 'dist/src/infrastructure/database/migrate.js';

/** Only what the process needs to run, so nothing from the developer's shell leaks into the check. */
const SYSTEM_ENV: NodeJS.ProcessEnv = {
  PATH: process.env.PATH,
  SystemRoot: process.env.SystemRoot,
  TEMP: process.env.TEMP,
  TMP: process.env.TMP,
};

const productionEnv = (port: number): NodeJS.ProcessEnv => ({
  ...SYSTEM_ENV,
  NODE_ENV: 'production',
  PORT: String(port),
  DATABASE_URL: 'postgres://user:pass@127.0.0.1:1/postgres',
  DATABASE_PREPARED_STATEMENTS: 'false',
  AUTH_MODE: 'jwt',
  AUTH_SECRET: 'smoke-only-secret-smoke-only-secret-0123456789',
  AUTH_JWT_ISSUER: 'https://smoke.apothem.test',
  AUTH_JWT_AUDIENCE: 'apothem-api',
});

const failures: string[] = [];
const check = (condition: boolean, label: string, detail = ''): void => {
  console.log(`${condition ? 'ok  ' : 'FAIL'} ${label}${condition || !detail ? '' : ` (${detail})`}`);
  if (!condition) failures.push(label);
};

async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as net.AddressInfo;
      server.close(() => resolve(port));
    });
  });
}

function run(entry: string, env: NodeJS.ProcessEnv): { child: ChildProcess; output: () => string; exited: Promise<number | null> } {
  const child = spawn(process.execPath, [entry], { env, stdio: ['ignore', 'pipe', 'pipe'] });
  let text = '';
  child.stdout?.on('data', (chunk: Buffer) => (text += chunk.toString()));
  child.stderr?.on('data', (chunk: Buffer) => (text += chunk.toString()));
  const exited = new Promise<number | null>((resolve) => child.once('exit', (code) => resolve(code)));
  return { child, output: () => text, exited };
}

async function waitFor(url: string, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      if ((await fetch(url)).status === 200) return true;
    } catch {
      // not listening yet
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  return false;
}

async function withTimeout<T>(promise: Promise<T>, ms: number, fallback: T): Promise<T> {
  return Promise.race([promise, new Promise<T>((resolve) => setTimeout(() => resolve(fallback), ms))]);
}

async function bootsAndServes(): Promise<void> {
  const port = await freePort();
  const base = `http://127.0.0.1:${port}`;
  const server = run(ENTRY, productionEnv(port));

  const up = await waitFor(`${base}/health`, 20_000);
  check(up, 'the built server starts and answers /health', server.output().slice(-300));
  if (up) {
    check((await fetch(`${base}/ready`)).status === 503, '/ready reports 503 while the database is unreachable, instead of crashing');
    check((await fetch(`${base}/health`)).status === 200, 'it keeps serving after a failed readiness check');
    const openapi = await fetch(`${base}/v1/openapi.json`);
    check(openapi.status === 200, 'it serves the OpenAPI document');

    const organizations = `${base}/v1/organizations/11111111-1111-4111-8111-111111111111`;
    check((await fetch(organizations)).status === 401, 'a request without credentials is refused with 401');
    const forged = await fetch(organizations, { headers: { 'x-principal-id': '22222222-2222-4222-8222-222222222222' } });
    check(forged.status === 401, 'the dev x-principal-id header is ignored in production');
    const badToken = await fetch(organizations, { headers: { authorization: 'Bearer not.a.token' } });
    check(badToken.status === 401, 'an invalid bearer token is refused with 401');
    check(!server.output().includes('smoke-only-secret'), 'the logs never contain the signing secret');
    check(!server.output().includes('user:pass'), 'the logs never contain the database credentials');
  }

  server.child.kill('SIGTERM');
  const code = await withTimeout(server.exited, 10_000, -1);
  if (process.platform === 'win32') {
    // Windows has no SIGTERM: the process is ended abruptly, so a clean exit cannot be observed here. CI (Linux) checks it.
    console.log('skip it shuts down cleanly on SIGTERM (not observable on Windows)');
  } else {
    check(code === 0, 'it shuts down cleanly on SIGTERM', `exit code ${code}`);
  }
  if (code === -1) server.child.kill('SIGKILL');
}

async function refuses(label: string, env: NodeJS.ProcessEnv, expected: RegExp): Promise<void> {
  const server = run(ENTRY, env);
  const code = await withTimeout(server.exited, 15_000, -1);
  check(code !== 0 && code !== -1, `${label}: it refuses to start`, `exit code ${code}`);
  check(expected.test(server.output()), `${label}: it says why`, server.output().slice(-200));
  if (code === -1) server.child.kill('SIGKILL');
}

async function main(): Promise<void> {
  if (!existsSync(ENTRY) || !existsSync(MIGRATE)) {
    console.error(`FAIL the build is missing ${ENTRY} or ${MIGRATE}. Run "npm run build" first.`);
    process.exit(1);
  }
  check(true, `the build contains ${ENTRY} and ${MIGRATE}`);

  await bootsAndServes();

  const port = await freePort();
  await refuses('production with the dev authenticator', { ...productionEnv(port), AUTH_MODE: 'dev' }, /AUTH_MODE/);
  const { DATABASE_URL: _url, ...withoutDatabase } = productionEnv(port);
  await refuses('production without a database', withoutDatabase, /DATABASE_URL/);
  await refuses('production with a short signing secret', { ...productionEnv(port), AUTH_SECRET: 'short' }, /AUTH_SECRET/);

  if (failures.length > 0) {
    console.error(`\n${failures.length} check(s) failed:\n- ${failures.join('\n- ')}`);
    process.exit(1);
  }
  console.log('\nproduction smoke test passed');
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
