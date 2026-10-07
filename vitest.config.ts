import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'workers/**/*.test.ts'],
    // Server-building suites import fastify/swagger on a cold cache, which can
    // exceed the 5s default and made `beforeEach` hooks fail intermittently.
    testTimeout: 30_000,
    // Integration suites boot an in-memory Postgres (WASM) in beforeAll; several start in parallel,
    // which can take well over 30s on a loaded or cold machine.
    hookTimeout: 120_000,
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['**/*.test.ts', '**/__fixtures__/**', 'src/main/**'],
      reporter: ['text-summary', 'json-summary', 'lcov'],
      // Floors are a ratchet: raise them as coverage grows, never lower them.
      thresholds: {
        lines: 90,
        functions: 86,
        branches: 87,
        statements: 90,
        // Security-critical code carries a higher floor.
        'src/modules/authorization/**': { lines: 90, functions: 90, branches: 87, statements: 90 },
        'src/modules/approvals/application/**': { lines: 90, functions: 90, branches: 85, statements: 90 },
        'src/modules/tools/domain/**': { lines: 90, functions: 90, branches: 85, statements: 90 },
        'src/modules/tools/application/**': { lines: 90, functions: 90, branches: 85, statements: 90 },
        'src/modules/runs/application/**': { lines: 88, functions: 88, branches: 82, statements: 88 },
        'src/modules/models/application/**': { lines: 90, functions: 85, branches: 80, statements: 85 },
        'src/modules/agents/application/**': { lines: 90, functions: 85, branches: 80, statements: 85 },
      },
    },
  },
});
