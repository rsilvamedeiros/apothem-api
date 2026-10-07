import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'workers/**/*.test.ts'],
    // Server-building suites import fastify/swagger on a cold cache, which can
    // exceed the 5s default and made `beforeEach` hooks fail intermittently.
    testTimeout: 30_000,
    hookTimeout: 30_000,
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['**/*.test.ts', '**/__fixtures__/**', 'src/main/**'],
      reporter: ['text-summary', 'json-summary', 'lcov'],
      // Floors are a ratchet: raise them as coverage grows, never lower them.
      thresholds: {
        lines: 72,
        functions: 60,
        branches: 78,
        statements: 72,
        // Security-critical code carries a higher floor.
        'src/modules/authorization/**': { lines: 90, functions: 90, branches: 85, statements: 90 },
        'src/modules/models/application/**': { lines: 85, functions: 85, branches: 80, statements: 85 },
        'src/modules/agents/application/**': { lines: 85, functions: 85, branches: 80, statements: 85 },
      },
    },
  },
});
