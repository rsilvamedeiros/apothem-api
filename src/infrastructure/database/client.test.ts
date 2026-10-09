import { describe, expect, it } from 'vitest';
import { postgresOptions } from './client.js';

describe('postgresOptions', () => {
  it('uses the configured pool size and keeps prepared statements by default', () => {
    expect(postgresOptions({ DATABASE_POOL_MAX: 10, DATABASE_PREPARED_STATEMENTS: true })).toEqual({ max: 10, prepare: true });
  });

  it('turns prepared statements off for a transaction pooler', () => {
    expect(postgresOptions({ DATABASE_POOL_MAX: 5, DATABASE_PREPARED_STATEMENTS: false })).toEqual({ max: 5, prepare: false });
  });

  it('lets a caller narrow the pool, as the migration does with a single connection', () => {
    expect(postgresOptions({ DATABASE_POOL_MAX: 10, DATABASE_PREPARED_STATEMENTS: false }, 1)).toEqual({ max: 1, prepare: false });
  });

  it('never lets a narrower pool exceed the configured one', () => {
    expect(postgresOptions({ DATABASE_POOL_MAX: 3, DATABASE_PREPARED_STATEMENTS: true }, 8)).toEqual({ max: 3, prepare: true });
  });
});
