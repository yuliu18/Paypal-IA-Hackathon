// Schema migrations, applied in order and recorded in <guard>.schema_migrations, so running them
// again (every server start, every deploy) changes nothing. One transaction under an advisory lock:
// two processes starting together apply each migration once, and a failed one leaves nothing half
// applied.
//
// Two stores, as the owner asked: schema `auth` is reserved for accounts (created empty here; the
// login owns its content, and Neon Auth keeps its own users in schema `neon_auth`), and schema
// `guard` holds what the guard writes: its black box and the installation's settings.

import { schemaName, type Db } from './db.ts';

type Migration = { version: number; name: string; statements: (s: string) => string[] };

// Columns mirror the SQLite black box (lib/guard/adapters/sqlite-audit-log.ts) one for one, as text
// where SQLite stores text, so a row hashes the same in both. Never edit a migration that shipped:
// add the next one.
export const MIGRATIONS: Migration[] = [
  {
    version: 1,
    name: 'black box and settings',
    statements: (s) => [
      `CREATE TABLE IF NOT EXISTS ${s}.audit_log (
        id BIGINT PRIMARY KEY,
        kind TEXT NOT NULL,
        at TEXT NOT NULL,
        ref BIGINT,
        tool TEXT,
        args TEXT,
        task TEXT,
        decision TEXT,
        moved_minor BIGINT,
        moved_currency TEXT,
        moved_set SMALLINT NOT NULL,
        outcome TEXT,
        detail TEXT,
        resolves BIGINT,
        environment TEXT,
        prev_hash TEXT NOT NULL,
        hash TEXT NOT NULL
      )`,
      `CREATE INDEX IF NOT EXISTS audit_log_ref ON ${s}.audit_log (ref)`,
      `CREATE INDEX IF NOT EXISTS audit_log_resolves ON ${s}.audit_log (resolves)`,
      `CREATE INDEX IF NOT EXISTS audit_log_at ON ${s}.audit_log (at)`,
      // The highest id ever handed out, updated in the append's transaction (SQLite's
      // sqlite_sequence): rows deleted from the end of the log show as missing. Its row lock also
      // serializes appends across requests and server processes.
      `CREATE TABLE IF NOT EXISTS ${s}.audit_head (
        singleton BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (singleton),
        last_id BIGINT NOT NULL
      )`,
      `INSERT INTO ${s}.audit_head (singleton, last_id) VALUES (TRUE, 0) ON CONFLICT DO NOTHING`,
      // Each record with its latest settlement applied, as SQLite's audit_state view.
      `CREATE OR REPLACE VIEW ${s}.audit_state AS
      SELECT r.id, r.at, r.tool, r.args, r.task, r.decision, r.resolves, r.environment,
        COALESCE((SELECT x.outcome FROM ${s}.audit_log x WHERE x.ref = r.id AND x.outcome IS NOT NULL ORDER BY x.id DESC LIMIT 1), r.outcome) AS outcome,
        COALESCE((SELECT x.detail FROM ${s}.audit_log x WHERE x.ref = r.id AND x.detail IS NOT NULL ORDER BY x.id DESC LIMIT 1), r.detail) AS detail,
        CASE WHEN EXISTS (SELECT 1 FROM ${s}.audit_log x WHERE x.ref = r.id AND x.moved_set = 1)
          THEN (SELECT x.moved_minor FROM ${s}.audit_log x WHERE x.ref = r.id AND x.moved_set = 1 ORDER BY x.id DESC LIMIT 1)
          ELSE r.moved_minor END AS moved_minor,
        CASE WHEN EXISTS (SELECT 1 FROM ${s}.audit_log x WHERE x.ref = r.id AND x.moved_set = 1)
          THEN (SELECT x.moved_currency FROM ${s}.audit_log x WHERE x.ref = r.id AND x.moved_set = 1 ORDER BY x.id DESC LIMIT 1)
          ELSE r.moved_currency END AS moved_currency
      FROM ${s}.audit_log r WHERE r.kind = 'record'`,
      // One row per installation: the settings as lib/settings writes them (keys already sealed).
      `CREATE TABLE IF NOT EXISTS ${s}.settings (
        installation TEXT PRIMARY KEY,
        data TEXT NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )`,
      // The generated key that seals saved keys when SETTINGS_SECRET is not set (settings.key on disk).
      `CREATE TABLE IF NOT EXISTS ${s}.settings_key (
        installation TEXT PRIMARY KEY,
        key TEXT NOT NULL
      )`,
    ],
  },
  {
    version: 2,
    name: 'api keys',
    statements: (s) => [
      // Keys the business's own app calls the agent API with (lib/apikeys): only the SHA-256 hash
      // of each key is kept, with its last 4 characters to tell keys apart.
      `CREATE TABLE IF NOT EXISTS ${s}.api_keys (
        id UUID PRIMARY KEY,
        name TEXT NOT NULL,
        hash TEXT NOT NULL UNIQUE,
        last4 TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL,
        last_used_at TIMESTAMPTZ,
        revoked_at TIMESTAMPTZ
      )`,
    ],
  },
];

export type MigrateOptions = { guardSchema?: string; authSchema?: string | null };

// Returns the versions applied by this call (empty when the database was already current).
export async function migrate(db: Db, { guardSchema = 'guard', authSchema = 'auth' }: MigrateOptions = {}): Promise<number[]> {
  const s = schemaName(guardSchema);
  return db.transaction(async (tx) => {
    // Any constant: it only has to be the same in every process running migrations.
    await tx.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [`migrate:${s}`]);
    if (authSchema !== null) await tx.query(`CREATE SCHEMA IF NOT EXISTS ${schemaName(authSchema)}`);
    await tx.query(`CREATE SCHEMA IF NOT EXISTS ${s}`);
    await tx.query(`CREATE TABLE IF NOT EXISTS ${s}.schema_migrations (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )`);
    const done = new Set((await tx.query<{ version: number }>(`SELECT version FROM ${s}.schema_migrations`)).rows.map((r) => Number(r.version)));
    const applied: number[] = [];
    for (const migration of MIGRATIONS) {
      if (done.has(migration.version)) continue;
      for (const statement of migration.statements(s)) await tx.query(statement);
      await tx.query(`INSERT INTO ${s}.schema_migrations (version, name) VALUES ($1, $2)`, [migration.version, migration.name]);
      applied.push(migration.version);
    }
    return applied;
  });
}
