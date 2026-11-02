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
  const tables = async (schema: string) =>
    (await db.query<{ table_name: string }>(`SELECT table_name FROM information_schema.tables WHERE table_schema = $1 ORDER BY table_name`, [schema])).rows.map((r) => r.table_name);

  it('creates the two stores: the auth schema for the owner account and its sessions, the guard schema for its data', async () => {
    expect(await migrate(db)).toEqual(MIGRATIONS.map((m) => m.version));
    expect(await schemas()).toEqual(['auth', 'guard']);
    expect(await tables('auth')).toEqual(['owner', 'sessions']);
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
    expect(await tables('guard_probe_x')).toEqual(expect.arrayContaining(['owner', 'sessions']));
  });

  it('keeps one owner row at most: id 1 only', async () => {
    await migrate(db);
    const insert = (id: number) => db.query(`INSERT INTO auth.owner (id, email, password_hash, created_at, updated_at) VALUES ($1, 'o@x.example', 'h', now(), now())`, [id]);
    await insert(1);
    await expect(insert(2)).rejects.toThrow();
    await expect(insert(1)).rejects.toThrow();
  });

  it('upgrades a database migrated before the owner tables existed, leaving its data alone', async () => {
    const before = MIGRATIONS.splice(2);
    try {
      expect(await migrate(db)).toEqual([1, 2]);
    } finally {
      MIGRATIONS.push(...before);
    }
    await db.query(`INSERT INTO guard.settings (installation, data) VALUES ('default', '{}')`);
    expect(await migrate(db)).toEqual([3]);
    expect(await tables('auth')).toEqual(['owner', 'sessions']);
    expect((await db.query(`SELECT installation FROM guard.settings`)).rows).toEqual([{ installation: 'default' }]);
  });

  it('refuses a schema name that is not a plain identifier', () => {
    expect(() => schemaName('guard; DROP SCHEMA auth')).toThrow('Not a valid schema name');
  });
});
