import { defineConfig, mergeConfig } from 'vitest/config';
import base from './vitest.config.js';

/**
 * Mutation testing runs each mutant against the covering tests, many times.
 * The unit and route suites already pin the behavior being mutated, so the
 * slow Postgres integration suites are left out here (they still run in CI).
 */
export default mergeConfig(
  base,
  defineConfig({
    test: { exclude: ['**/node_modules/**', '**/*.integration.test.ts'], coverage: { enabled: false } },
  }),
);
