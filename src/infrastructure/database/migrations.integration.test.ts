import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { createTestDatabase, type TestDatabase } from './__fixtures__/test-database.js';

describe('committed migrations (integration)', () => {
  let database: TestDatabase;

  beforeAll(async () => {
    database = await createTestDatabase();
  });

  afterAll(async () => {
    await database.close();
  });

  async function rows<T>(query: ReturnType<typeof sql>): Promise<T[]> {
    const result = (await database.db.execute(query)) as unknown as { rows: T[] };
    return result.rows;
  }

  it('creates every tenant-owned table', async () => {
    const tables = (
      await rows<{ table_name: string }>(
        sql`select table_name from information_schema.tables where table_schema = 'public'`,
      )
    ).map((row) => row.table_name);

    expect(tables).toEqual(
      expect.arrayContaining([
        'principals',
        'organizations',
        'memberships',
        'workspaces',
        'workspace_memberships',
        'audit_events',
        'agents',
        'agent_drafts',
        'agent_versions',
        'runs',
        'run_steps',
      ]),
    );
  });

  it('enforces tenant ownership columns as NOT NULL on tenant-owned tables', async () => {
    const nullable = await rows<{ table_name: string; column_name: string }>(sql`
      select table_name, column_name from information_schema.columns
      where table_schema = 'public'
        and column_name in ('organization_id')
        and is_nullable = 'YES'
    `);
    expect(nullable).toEqual([]);
  });

  it('keeps audit events free of foreign keys that could cascade-delete history', async () => {
    const cascades = await rows<{ constraint_name: string }>(sql`
      select tc.constraint_name
      from information_schema.table_constraints tc
      join information_schema.referential_constraints rc on rc.constraint_name = tc.constraint_name
      where tc.table_name = 'audit_events' and rc.delete_rule = 'CASCADE'
    `);
    expect(cascades).toEqual([]);
  });
});
