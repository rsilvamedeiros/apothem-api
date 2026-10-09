import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { ENV_KEYS, loadEnv } from './env.js';

/**
 * The deployment files are code too: a variable renamed in the API but not in
 * render.yaml, or an entrypoint that moved, only shows up on deploy day. These
 * tests keep the files in agreement with the code (and `npm run smoke:prod`
 * boots the built output).
 */
const root = path.resolve(__dirname, '../../..');
const read = (relative: string) => readFileSync(path.join(root, relative), 'utf8').replace(/\r\n/g, '\n');

function parseDotenv(text: string): Record<string, string> {
  const values: Record<string, string> = {};
  for (const line of text.split('\n')) {
    const match = /^([A-Z][A-Z0-9_]*)=(.*)$/.exec(line.trim());
    if (match) values[match[1]!] = match[2]!;
  }
  return values;
}

interface RenderVar {
  key: string;
  value?: string;
  secret: boolean;
}

function parseRenderEnvVars(yaml: string): RenderVar[] {
  const vars: RenderVar[] = [];
  const lines = yaml.split('\n');
  for (let index = 0; index < lines.length; index += 1) {
    const key = /^\s+- key: (\w+)\s*$/.exec(lines[index]!)?.[1];
    if (!key) continue;
    const next = lines[index + 1]?.trim() ?? '';
    const value = /^value:\s*"?([^"]*)"?\s*$/.exec(next)?.[1];
    vars.push({ key, secret: next === 'sync: false', ...(value !== undefined ? { value } : {}) });
  }
  return vars;
}

describe('production environment example', () => {
  const example = parseDotenv(read('infra/render/env.production.example'));

  it('is a configuration the API accepts in production', () => {
    expect(loadEnv(example)).toMatchObject({
      NODE_ENV: 'production',
      AUTH_MODE: 'jwt',
      DATABASE_PREPARED_STATEMENTS: false,
      DATABASE_POOL_MAX: 5,
    });
  });

  it('only names variables the API actually reads', () => {
    for (const key of Object.keys(example)) {
      expect(ENV_KEYS, `${key} is not read by the API`).toContain(key);
    }
  });

  it('asks for the transaction pooler with SSL, and keeps prepared statements off with it', () => {
    expect(example.DATABASE_URL).toContain(':6543/');
    expect(example.DATABASE_URL).toContain('sslmode=require');
    expect(example.DATABASE_PREPARED_STATEMENTS).toBe('false');
  });

  it('never ships a usable secret: the placeholders are obviously fake', () => {
    expect(example.AUTH_SECRET).toMatch(/^REPLACE_WITH/);
    expect(example.DATABASE_URL).toContain('PASSWORD@');
    expect(read('infra/render/env.production.example')).not.toMatch(/sk-[A-Za-z0-9]{10,}/);
  });

  it('does not ask for anything the API refuses in production', () => {
    expect(() => loadEnv({ ...example, AUTH_MODE: 'dev' })).toThrow(/AUTH_MODE/);
    expect(example.AUTH_MODE).toBe('jwt');
  });
});

describe('render.yaml blueprint', () => {
  const yaml = read('infra/render/render.yaml');
  const vars = parseRenderEnvVars(yaml);
  const example = parseDotenv(read('infra/render/env.production.example'));

  it('declares only variables the API reads', () => {
    expect(vars.length).toBeGreaterThan(0);
    for (const { key } of vars) {
      expect(ENV_KEYS, `${key} is not read by the API`).toContain(key);
    }
  });

  it('declares every variable production needs', () => {
    const declared = vars.map((entry) => entry.key);
    for (const required of ['NODE_ENV', 'DATABASE_URL', 'AUTH_MODE', 'AUTH_SECRET', 'AUTH_JWT_ISSUER', 'AUTH_JWT_AUDIENCE']) {
      expect(declared, `${required} is missing from render.yaml`).toContain(required);
    }
  });

  it('keeps every secret out of the file: they are set in the dashboard', () => {
    const secrets = vars.filter((entry) => entry.secret).map((entry) => entry.key);
    expect(secrets).toEqual(expect.arrayContaining(['DATABASE_URL', 'AUTH_SECRET']));
    for (const entry of vars.filter((candidate) => candidate.secret)) {
      expect(entry.value, `${entry.key} must not carry a value`).toBeUndefined();
    }
    expect(yaml).not.toMatch(/postgres:\/\/\w+:\w+@/);
  });

  it('agrees with the example on every value it sets', () => {
    for (const entry of vars.filter((candidate) => candidate.value !== undefined)) {
      expect(example[entry.key], `${entry.key} differs between render.yaml and env.production.example`).toBe(entry.value);
    }
  });

  it('is production, signed tokens, on a Docker runtime with a liveness check that needs no database', () => {
    expect(vars.find((entry) => entry.key === 'NODE_ENV')?.value).toBe('production');
    expect(vars.find((entry) => entry.key === 'AUTH_MODE')?.value).toBe('jwt');
    expect(yaml).toMatch(/runtime: docker/);
    expect(yaml).toMatch(/healthCheckPath: \/health\s*$/m);
    expect(yaml).toMatch(/dockerfilePath: \.\/Dockerfile/);
  });
});

describe('Dockerfile and entrypoint', () => {
  const dockerfile = read('Dockerfile');
  const pkg = JSON.parse(read('package.json')) as { scripts: Record<string, string>; engines: { node: string } };
  const tsconfig = JSON.parse(read('tsconfig.json')) as { compilerOptions: { outDir: string; rootDir: string } };

  it('starts the file the compiler really emits (outDir + rootDir decide the layout)', () => {
    // rootDir "." keeps the "src" folder, so the entrypoint is dist/src/main/index.js, not dist/main/index.js.
    expect(tsconfig.compilerOptions).toMatchObject({ outDir: 'dist', rootDir: '.' });
    expect(pkg.scripts.start).toBe('node dist/src/main/index.js');
    expect(pkg.scripts['start:prod']).toBe('node dist/src/infrastructure/database/migrate.js && node dist/src/main/index.js');
  });

  it('migrates before it serves, and the image carries what the migration reads', () => {
    expect(dockerfile).toMatch(/CMD \["npm", "run", "start:prod"\]/);
    expect(dockerfile).toMatch(/COPY migrations \.\/migrations/);
    expect(dockerfile).toMatch(/COPY --from=build \/app\/dist \.\/dist/);
  });

  it('runs as a non-root user with production dependencies only', () => {
    expect(dockerfile).toMatch(/^USER node$/m);
    expect(dockerfile).toMatch(/npm ci --omit=dev/);
    expect(dockerfile).toMatch(/ENV NODE_ENV=production/);
  });

  it('exposes the port the API defaults to, and checks liveness, not readiness', () => {
    const defaultPort = loadEnv({ DATABASE_URL: 'postgres://u:p@h:5432/d', AUTH_SECRET: 'x' }).PORT;
    expect(dockerfile).toContain(`EXPOSE ${defaultPort}`);
    const healthcheck = dockerfile.split('HEALTHCHECK')[1]?.split('\n# ')[0] ?? '';
    expect(healthcheck).toContain('/health');
    expect(healthcheck).not.toContain('/ready');
  });

  it('puts no secret in the image', () => {
    expect(dockerfile).not.toMatch(/AUTH_SECRET|DATABASE_URL|API_KEY/);
  });

  it('uses a Node version the project supports', () => {
    expect(pkg.engines.node).toBe('>=20');
    expect(dockerfile).toMatch(/FROM node:20-slim AS build/);
    expect(dockerfile).toMatch(/FROM node:20-slim AS runtime/);
  });

  it('keeps local secrets and build output out of the build context', () => {
    const ignore = read('.dockerignore').split('\n');
    for (const entry of ['node_modules', 'dist', '.env', '.git']) {
      expect(ignore).toContain(entry);
    }
    expect(ignore).toContain('!.env.example');
  });
});
