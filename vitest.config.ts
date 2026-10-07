import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'workers/**/*.test.ts'],
    // Server-building suites import fastify/swagger on a cold cache, which can
    // exceed the 5s default and made `beforeEach` hooks fail intermittently.
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
