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
        lines: 60,
        functions: 50,
        branches: 50,
        statements: 60,
        // Security-critical code carries a higher floor.
        'src/modules/authorization/**': { lines: 90, functions: 90, branches: 85, statements: 90 },
      },
    },
  },
});
