import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Db } from './db';
import { schemaName } from './db';
import { MIGRATIONS, migrate } from './migrations';
import { createPgliteDb } from './pglite';

let db: Db;

beforeEach(async () => {
  db = await createPgliteDb();
});

afterEach(() => db.close());

const schemas = async () =>
  (await db.query<{ nspname: string }>(`SELECT nspname FROM pg_namespace WHERE nspname IN ('auth', 'guard') ORDER BY nspname`)).rows.map((r) => r.nspname);

describe('database migrations', () => {
  it('creates the two stores: an empty auth schema for accounts and the guard schema for its data', async () => {
    expect(await migrate(db)).toEqual(MIGRATIONS.map((m) => m.version));
    expect(await schemas()).toEqual(['auth', 'guard']);
    const authTables = await db.query(`SELECT 1 FROM information_schema.tables WHERE table_schema = 'auth'`);
    expect(authTables.rows).toEqual([]);
    const guardTables = (await db.query<{ table_name: string }>(`SELECT table_name FROM information_schema.tables WHERE table_schema = 'guard' ORDER BY table_name`)).rows.map((r) => r.table_name);
    expect(guardTables).toEqual(['api_keys', 'audit_head', 'audit_log', 'audit_state', 'schema_migrations', 'settings', 'settings_key']);
  });

  it('applies nothing the second time', async () => {
    await migrate(db);
    expect(await migrate(db)).toEqual([]);
    expect((await db.query(`SELECT version FROM guard.schema_migrations`)).rows).toHaveLength(MIGRATIONS.length);
  });

  it('migrates a separate guard schema and can leave the auth schema alone', async () => {
    await migrate(db, { guardSchema: 'guard_probe_x', authSchema: null });
    expect(await schemas()).toEqual([]);
    expect((await db.query(`SELECT last_id FROM guard_probe_x.audit_head`)).rows).toEqual([{ last_id: 0 }]);
  });

  it('refuses a schema name that is not a plain identifier', () => {
    expect(() => schemaName('guard; DROP SCHEMA auth')).toThrow('Not a valid schema name');
  });
});
