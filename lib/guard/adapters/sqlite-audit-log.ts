// AuditLog on SQLite (Node's built-in node:sqlite, no native dependency): the guard's black box.
// The log only ever grows. A guard decision appends a record, and its later outcome appends a
// settlement that points at it, so nothing written is ever rewritten. Every row carries the hash
// of the row before it, so changing or deleting any row breaks the chain, which verifyChain finds.
// Amounts are stored in minor units so daily totals are exact sums.

import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import type { Money } from '../domain/policy';
import type { AuditEntry, AuditLog, AuditRow } from '../ports';

export type { AuditRow };

export type ChainCheck =
  | { intact: true; records: number; head: string | null }
  | { intact: false; brokenAt: string; reason: string };

export type SqliteAuditLog = AuditLog & {
  list(limit: number): AuditRow[];
  verifyChain(): ChainCheck;
};

// One row of the append-only table, as stored: every column is part of the hash.
type LogRow = {
  id: number;
  kind: 'record' | 'settle';
  at: string;
  ref: number | null;
  tool: string | null;
  args: string | null;
  task: string | null;
  decision: string | null;
  moved_minor: number | null;
  moved_currency: string | null;
  moved_set: number;
  outcome: string | null;
  detail: string | null;
  resolves: number | null;
  prev_hash: string;
  hash: string;
};

// A record with its settlements applied, as the audit_state view returns it.
type StateRow = {
  id: number;
  at: string;
  tool: string;
  args: string;
  task: string;
  decision: string;
  moved_minor: number | null;
  moved_currency: string | null;
  outcome: AuditEntry['outcome'];
  detail: string | null;
  resolves: number | null;
};

const GENESIS = '0'.repeat(64);

// The row id is left out: it is only known after the insert, and the prev_hash links already pin
// each row's place in the chain.
function hashOf(row: Omit<LogRow, 'id' | 'hash'>): string {
  const content = [
    row.prev_hash,
    row.kind,
    row.at,
    row.ref,
    row.tool,
    row.args,
    row.task,
    row.decision,
    row.moved_minor,
    row.moved_currency,
    row.moved_set,
    row.outcome,
    row.detail,
    row.resolves,
  ];
  return createHash('sha256').update(JSON.stringify(content)).digest('hex');
}

const toEntry = (row: StateRow): AuditRow => ({
  id: String(row.id),
  at: row.at,
  tool: row.tool,
  args: JSON.parse(row.args),
  task: JSON.parse(row.task),
  decision: JSON.parse(row.decision),
  moved: row.moved_minor === null || row.moved_currency === null ? undefined : { minor: row.moved_minor, currency: row.moved_currency },
  outcome: row.outcome,
  detail: row.detail ?? undefined,
  ...(row.resolves === null ? {} : { resolves: String(row.resolves) }),
});

export function createSqliteAuditLog(path: string): SqliteAuditLog {
  const db = new DatabaseSync(path);
  // A new table: logs from before the chain (table `audit`) are left as they were, unread.
  db.exec(`
    CREATE TABLE IF NOT EXISTS audit_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      kind TEXT NOT NULL,
      at TEXT NOT NULL,
      ref INTEGER,
      tool TEXT,
      args TEXT,
      task TEXT,
      decision TEXT,
      moved_minor INTEGER,
      moved_currency TEXT,
      moved_set INTEGER NOT NULL,
      outcome TEXT,
      detail TEXT,
      resolves INTEGER,
      prev_hash TEXT NOT NULL,
      hash TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS audit_log_ref ON audit_log (ref);
    CREATE INDEX IF NOT EXISTS audit_log_resolves ON audit_log (resolves);
    CREATE INDEX IF NOT EXISTS audit_log_at ON audit_log (at);

    -- Each record with its latest settlement applied. A settlement that sets the amount wins even
    -- when it clears it (moved_set = 1 with a null amount).
    CREATE VIEW IF NOT EXISTS audit_state AS
    SELECT r.id, r.at, r.tool, r.args, r.task, r.decision, r.resolves,
      COALESCE((SELECT s.outcome FROM audit_log s WHERE s.ref = r.id AND s.outcome IS NOT NULL ORDER BY s.id DESC LIMIT 1), r.outcome) AS outcome,
      COALESCE((SELECT s.detail FROM audit_log s WHERE s.ref = r.id AND s.detail IS NOT NULL ORDER BY s.id DESC LIMIT 1), r.detail) AS detail,
      CASE WHEN EXISTS (SELECT 1 FROM audit_log s WHERE s.ref = r.id AND s.moved_set = 1)
        THEN (SELECT s.moved_minor FROM audit_log s WHERE s.ref = r.id AND s.moved_set = 1 ORDER BY s.id DESC LIMIT 1)
        ELSE r.moved_minor END AS moved_minor,
      CASE WHEN EXISTS (SELECT 1 FROM audit_log s WHERE s.ref = r.id AND s.moved_set = 1)
        THEN (SELECT s.moved_currency FROM audit_log s WHERE s.ref = r.id AND s.moved_set = 1 ORDER BY s.id DESC LIMIT 1)
        ELSE r.moved_currency END AS moved_currency
    FROM audit_log r WHERE r.kind = 'record';
  `);

  const lastHash = db.prepare(`SELECT hash FROM audit_log ORDER BY id DESC LIMIT 1`);
  const insert = db.prepare(
    `INSERT INTO audit_log (kind, at, ref, tool, args, task, decision, moved_minor, moved_currency, moved_set, outcome, detail, resolves, prev_hash, hash)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  // Pending entries count too: their call may have moved money even if it never settled.
  const sumSince = db.prepare(
    `SELECT COALESCE(SUM(moved_minor), 0) AS total FROM audit_state WHERE at >= ? AND moved_currency = ?`,
  );
  const latest = db.prepare(`SELECT * FROM audit_state ORDER BY id DESC LIMIT ?`);
  const byId = db.prepare(`SELECT * FROM audit_state WHERE id = ?`);
  const resolver = db.prepare(`SELECT 1 FROM audit_log WHERE kind = 'record' AND resolves = ? LIMIT 1`);
  const unsettled = db.prepare(
    `SELECT 1 FROM audit_state WHERE tool = 'create_refund' AND json_extract(args, '$.capture_id') = ?
       AND moved_minor IS NOT NULL AND outcome IN ('pending', 'error') LIMIT 1`,
  );
  const everyRow = db.prepare(`SELECT * FROM audit_log ORDER BY id`);

  // Synchronous from reading the last hash to the insert, so no other write can slip in between.
  function append(raw: Omit<LogRow, 'id' | 'prev_hash' | 'hash'>): string {
    // SQLite stores a lone surrogate as U+FFFD; hash what it will read back, not what was passed.
    const row = Object.fromEntries(
      Object.entries(raw).map(([key, value]) => [key, typeof value === 'string' ? value.toWellFormed() : value]),
    ) as typeof raw;
    const prev_hash = (lastHash.get() as { hash: string } | undefined)?.hash ?? GENESIS;
    const hash = hashOf({ ...row, prev_hash });
    const { lastInsertRowid } = insert.run(
      row.kind,
      row.at,
      row.ref,
      row.tool,
      row.args,
      row.task,
      row.decision,
      row.moved_minor,
      row.moved_currency,
      row.moved_set,
      row.outcome,
      row.detail,
      row.resolves,
      prev_hash,
      hash,
    );
    return String(lastInsertRowid);
  }

  return {
    async record(entry) {
      return append({
        kind: 'record',
        at: entry.at,
        ref: null,
        tool: entry.tool,
        args: JSON.stringify(entry.args),
        task: JSON.stringify(entry.task),
        decision: JSON.stringify(entry.decision),
        moved_minor: entry.moved?.minor ?? null,
        moved_currency: entry.moved?.currency ?? null,
        moved_set: 1,
        outcome: entry.outcome,
        detail: entry.detail ?? null,
        resolves: entry.resolves === undefined ? null : Number(entry.resolves),
      });
    },

    async update(id, patch) {
      // Presence, not value, decides: an explicit `moved: undefined` clears the amount.
      const movedSet = 'moved' in patch;
      if (patch.outcome === undefined && patch.detail === undefined && !movedSet) return;
      append({
        kind: 'settle',
        at: new Date().toISOString(),
        ref: Number(id),
        tool: null,
        args: null,
        task: null,
        decision: null,
        moved_minor: movedSet ? (patch.moved?.minor ?? null) : null,
        moved_currency: movedSet ? (patch.moved?.currency ?? null) : null,
        moved_set: movedSet ? 1 : 0,
        outcome: patch.outcome ?? null,
        detail: patch.detail ?? null,
        resolves: null,
      });
    },

    async movedSince(since, currency): Promise<Money> {
      const { total } = sumSince.get(since.toISOString(), currency) as { total: number };
      return { minor: total, currency };
    },

    async hasUnsettledRefund(captureId) {
      return unsettled.get(captureId) !== undefined;
    },

    async get(id) {
      const row = byId.get(Number(id)) as StateRow | undefined;
      return row && toEntry(row);
    },

    async isResolved(id) {
      return resolver.get(Number(id)) !== undefined;
    },

    list(limit) {
      return (latest.all(limit) as unknown as StateRow[]).map(toEntry);
    },

    // Recomputes every hash from the stored content and follows the links from the first row.
    verifyChain() {
      let prev = GENESIS;
      let records = 0;
      for (const row of everyRow.iterate() as Iterable<LogRow>) {
        if (row.prev_hash !== prev) return { intact: false, brokenAt: String(row.id), reason: 'does not link to the row before it (a row was removed or altered)' };
        if (hashOf(row) !== row.hash) return { intact: false, brokenAt: String(row.id), reason: 'content does not match its hash (the row was altered)' };
        prev = row.hash;
        records++;
      }
      return { intact: true, records, head: records ? prev : null };
    },
  };
}
