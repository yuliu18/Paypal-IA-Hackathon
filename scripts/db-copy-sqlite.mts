// Copies the local SQLite black box (GUARD_AUDIT_DB or data/guard-audit.db) into Postgres
// (DATABASE_URL, schema `guard`) once, keeping every row's id, order and hash, then checks the chain
// there. Refuses when the Postgres log already has rows. The SQLite file is only read.
// Run with: npm run db:copy-sqlite

import { DatabaseSync } from 'node:sqlite';
import { getDb } from '../lib/db/client.ts';
import { createPostgresAuditLog } from '../lib/guard/adapters/postgres-audit-log.ts';

const path = process.env.GUARD_AUDIT_DB ?? 'data/guard-audit.db';
const db = getDb();
if (!db) {
  console.error('DATABASE_URL is not set.');
  process.exit(1);
}

const COLUMNS = ['id', 'kind', 'at', 'ref', 'tool', 'args', 'task', 'decision', 'moved_minor', 'moved_currency', 'moved_set', 'outcome', 'detail', 'resolves', 'environment', 'prev_hash', 'hash'];

try {
  const sqlite = new DatabaseSync(path, { readOnly: true });
  const hasEnvironment = (sqlite.prepare(`PRAGMA table_info(audit_log)`).all() as { name: string }[]).some((c) => c.name === 'environment');
  const rows = sqlite.prepare(`SELECT *${hasEnvironment ? '' : ', NULL AS environment'} FROM audit_log ORDER BY id`).all() as Record<string, unknown>[];
  const issued = Number((sqlite.prepare(`SELECT seq FROM sqlite_sequence WHERE name = 'audit_log'`).get() as { seq: number } | undefined)?.seq ?? 0);
  sqlite.close();
  // Postgres can't store NUL: such a row would change and no longer match its hash.
  const nul = rows.find((row) => Object.values(row).some((v) => typeof v === 'string' && v.includes('\u0000')));
  if (nul) throw new Error(`row ${nul.id} holds a NUL character, which Postgres cannot store`);

  await db.transaction(async (tx) => {
    const head = await tx.query<{ last_id: unknown }>(`SELECT last_id FROM guard.audit_head WHERE singleton FOR UPDATE`);
    const existing = await tx.query(`SELECT 1 FROM guard.audit_log LIMIT 1`);
    if (existing.rows.length || Number(head.rows[0].last_id) > 0) throw new Error('the Postgres black box already has rows; nothing was copied');
    for (const row of rows) {
      await tx.query(`INSERT INTO guard.audit_log (${COLUMNS.join(', ')}) VALUES (${COLUMNS.map((_, i) => `$${i + 1}`).join(', ')})`, COLUMNS.map((c) => row[c] ?? null));
    }
    await tx.query(`UPDATE guard.audit_head SET last_id = $1 WHERE singleton`, [Math.max(issued, rows.length ? Number(rows.at(-1)!.id) : 0)]);
  });
  const chain = await createPostgresAuditLog(db).verifyChain();
  console.log(`Copied ${rows.length} rows from ${path}. Chain in Postgres:`, chain);
  if (!chain.intact) process.exitCode = 1;
} catch (error) {
  console.error('Copy failed:', (error as Error).message);
  process.exitCode = 1;
} finally {
  await db.close();
}
