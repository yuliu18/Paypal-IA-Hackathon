// AuditLog on SQLite (Node's built-in node:sqlite, no native dependency): the guard's black box.
// The log only ever grows. A guard decision appends a record, and its later outcome appends a
// settlement that points at it, so nothing written is ever rewritten. Every row carries the hash
// of the row before it, so changing or deleting any row breaks the chain, which verifyChain finds.
// It cannot see a chain rewritten from scratch with fresh hashes: only a copy of the head hash kept
// somewhere else catches that.
// Amounts are stored in minor units so daily totals are exact sums.

import { DatabaseSync } from 'node:sqlite';
import type { Money } from '../domain/policy';
import type { AuditLog, AuditRow, ChainCheck } from '../ports';
import { boundOrderDetail, GENESIS, hashOf, ORDER_ID, recordRow, settleRow, soleCustomer, toEntry, type LogRow, type StateRow } from './audit-chain.ts';

// Type-only imports from the app above, and the shared chain by its .ts path: other processes load
// this file with plain Node (see the test that appends from several processes), which can't resolve
// the app's extensionless imports.

export type { AuditRow, ChainCheck };

export type SqliteAuditLog = AuditLog & {
  list(limit: number): AuditRow[];
  // reuseFullCheckMs > 0 skips rows a full check already verified within that window, re-checking
  // only rows added since and the last verified row; 0 always checks the whole chain.
  verifyChain(reuseFullCheckMs?: number, now?: number): ChainCheck;
};

export function createSqliteAuditLog(path: string): SqliteAuditLog {
  const db = new DatabaseSync(path);
  // Other processes may append to the same file: wait for their write instead of failing, and let
  // readers see a consistent snapshot while they write.
  db.exec(`PRAGMA busy_timeout = 5000; PRAGMA journal_mode = WAL;`);
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
      environment TEXT,
      prev_hash TEXT NOT NULL,
      hash TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS audit_log_ref ON audit_log (ref);
    CREATE INDEX IF NOT EXISTS audit_log_resolves ON audit_log (resolves);
    CREATE INDEX IF NOT EXISTS audit_log_at ON audit_log (at);

  `);
  // A file from before the environment was recorded gets the column (its rows stay null and read as
  // sandbox) and the view that returns it.
  if (!(db.prepare(`PRAGMA table_info(audit_log)`).all() as { name: string }[]).some((c) => c.name === 'environment')) {
    db.exec(`ALTER TABLE audit_log ADD COLUMN environment TEXT`);
  }
  if (!(db.prepare(`PRAGMA table_info(audit_state)`).all() as { name: string }[]).some((c) => c.name === 'environment')) {
    db.exec(`DROP VIEW IF EXISTS audit_state`);
  }
  db.exec(`
    -- Each record with its latest settlement applied. A settlement that sets the amount wins even
    -- when it clears it (moved_set = 1 with a null amount).
    CREATE VIEW IF NOT EXISTS audit_state AS
    SELECT r.id, r.at, r.tool, r.args, r.task, r.decision, r.resolves, r.environment,
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
    `INSERT INTO audit_log (id, kind, at, ref, tool, args, task, decision, moved_minor, moved_currency, moved_set, outcome, detail, resolves, environment, prev_hash, hash)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  // Pending entries count too: their call may have moved money even if it never settled. An
  // invoice's amount is money billed, not refunded, so each sum only sees its own kind of entry;
  // creating an order moves no money (the buyer pays it later, in PayPal), so neither sum sees it.
  const sumSince = db.prepare(
    `SELECT COALESCE(SUM(moved_minor), 0) AS total FROM audit_state WHERE at >= ? AND moved_currency = ? AND COALESCE(tool, '') NOT IN ('create_invoice', 'create_order')`,
  );
  const billedSumSince = db.prepare(
    `SELECT COALESCE(SUM(moved_minor), 0) AS total FROM audit_state WHERE at >= ? AND moved_currency = ? AND tool = 'create_invoice'`,
  );
  const latest = db.prepare(`SELECT * FROM audit_state ORDER BY id DESC LIMIT ?`);
  const byId = db.prepare(`SELECT * FROM audit_state WHERE id = ?`);
  const resolver = db.prepare(`SELECT 1 FROM audit_log WHERE kind = 'record' AND resolves = ? LIMIT 1`);
  const unsettled = db.prepare(
    `SELECT 1 FROM audit_state WHERE tool = 'create_refund' AND json_extract(args, '$.capture_id') = ?
       AND moved_minor IS NOT NULL AND outcome IN ('pending', 'error') LIMIT 1`,
  );
  // An executed create_order whose detail records the binding, alone or after a late-answer note
  // (executeWrite joins details with '; '). Order ids are [A-Z0-9], so they hold no LIKE wildcard.
  const boundOrder = db.prepare(
    `SELECT DISTINCT json_extract(task, '$.mandate.customerEmail') AS customer FROM audit_state
       WHERE tool = 'create_order' AND outcome = 'executed' AND (detail = ? OR detail LIKE ?)
         AND (? IS NULL OR COALESCE(environment, 'sandbox') = ?)`,
  );
  const rowsAfter = db.prepare(`SELECT * FROM audit_log WHERE id > ? ORDER BY id`);
  const hashAt = db.prepare(`SELECT hash FROM audit_log WHERE id = ?`);
  // AUTOINCREMENT remembers the highest id ever handed out, even after that row is deleted.
  const lastIssued = db.prepare(`SELECT seq FROM sqlite_sequence WHERE name = 'audit_log'`);

  // The last full check, so a later one within the window only reads the rows added since.
  let verified: { id: number; hash: string; records: number; at: number } | undefined;

  // BEGIN IMMEDIATE takes the write lock before the last hash is read, so another process cannot
  // append between that read and the insert and fork the chain.
  function inWriteTransaction<T>(work: () => T): T {
    db.exec('BEGIN IMMEDIATE');
    try {
      const result = work();
      db.exec('COMMIT');
      return result;
    } catch (error) {
      // SQLite may have rolled back already (some I/O and busy errors do); keep the original error.
      if (db.isTransaction) db.exec('ROLLBACK');
      throw error;
    }
  }

  // Call inside inWriteTransaction. An id is given only when carrying over a pre-chain log.
  function append(raw: Omit<LogRow, 'id' | 'prev_hash' | 'hash'>, id: number | null = null): string {
    // SQLite stores a lone surrogate as U+FFFD; hash what it will read back, not what was passed.
    const row = Object.fromEntries(
      Object.entries(raw).map(([key, value]) => [key, typeof value === 'string' ? value.toWellFormed() : value]),
    ) as typeof raw;
    const prev_hash = (lastHash.get() as { hash: string } | undefined)?.hash ?? GENESIS;
    const hash = hashOf({ ...row, prev_hash });
    const { lastInsertRowid } = insert.run(
      id,
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
      row.environment,
      prev_hash,
      hash,
    );
    return String(lastInsertRowid);
  }

  carryOverLegacyLog();

  // A log from before the chain (table `audit`, one row per call with its final outcome) is copied
  // into the empty chain once, so its pending refunds and today's total keep counting toward the
  // limits. Rows are renumbered 1..n, since the chain treats a gap in ids as a removed row, and a
  // decision's `resolves` follows its held entry to the new id. The old table is left as it was.
  function carryOverLegacyLog() {
    const legacy = db.prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'audit'`).get();
    if (!legacy) return;
    inWriteTransaction(() => {
      if (lastHash.get()) return;
      const hasResolves = (db.prepare(`PRAGMA table_info(audit)`).all() as { name: string }[]).some((c) => c.name === 'resolves');
      const rows = db
        .prepare(`SELECT *${hasResolves ? '' : ', NULL AS resolves'} FROM audit ORDER BY id`)
        .all() as unknown as Omit<StateRow, 'environment'>[];
      const renumbered = new Map(rows.map((row, i) => [row.id, i + 1]));
      for (const row of rows) {
        append(
          {
            kind: 'record',
            at: row.at,
            ref: null,
            tool: row.tool,
            args: row.args,
            task: row.task,
            decision: row.decision,
            moved_minor: row.moved_minor,
            moved_currency: row.moved_currency,
            moved_set: 1,
            outcome: row.outcome,
            detail: row.detail,
            resolves: row.resolves === null ? null : (renumbered.get(row.resolves) ?? null),
            environment: null,
          },
          renumbered.get(row.id)!,
        );
      }
    });
  }

  function check(reuseFullCheckMs: number, now: number): ChainCheck {
    const reuse =
      verified && now - verified.at < reuseFullCheckMs && (hashAt.get(verified.id) as { hash: string } | undefined)?.hash === verified.hash
        ? verified
        : undefined;
    let prev = reuse?.hash ?? GENESIS;
    let records = reuse?.records ?? 0;
    let last = reuse?.id ?? 0;
    for (const row of rowsAfter.iterate(last) as Iterable<LogRow>) {
      if (row.prev_hash !== prev) return { intact: false, brokenAt: String(row.id), reason: 'does not link to the row before it (a row was removed or altered)' };
      if (hashOf(row) !== row.hash) return { intact: false, brokenAt: String(row.id), reason: 'content does not match its hash (the row was altered)' };
      // Ids are handed out one by one, so a gap is a row deleted from the end before the next append.
      if (row.id !== last + 1) return { intact: false, brokenAt: String(last + 1), reason: 'is missing: a row was removed' };
      prev = row.hash;
      records++;
      last = row.id;
    }
    const issued = (lastIssued.get() as { seq: number } | undefined)?.seq ?? 0;
    if (issued > last) return { intact: false, brokenAt: String(last + 1), reason: 'is missing: the newest rows were removed' };
    if (records) verified = { id: last, hash: prev, records, at: reuse?.at ?? now };
    return { intact: true, records, head: records ? prev : null };
  }

  return {
    async record(entry) {
      return inWriteTransaction(() => append(recordRow(entry)));
    },

    async update(id, patch) {
      const row = settleRow(id, patch, new Date().toISOString());
      if (row) inWriteTransaction(() => append(row));
    },

    async movedSince(since, currency): Promise<Money> {
      const { total } = sumSince.get(since.toISOString(), currency) as { total: number };
      return { minor: total, currency };
    },

    async billedSince(since, currency): Promise<Money> {
      const { total } = billedSumSince.get(since.toISOString(), currency) as { total: number };
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

    async boundOrderCustomer(orderId, environment) {
      if (!ORDER_ID.test(orderId)) return undefined;
      const detail = boundOrderDetail(orderId);
      const only = environment === undefined ? null : environment === 'live' ? 'live' : 'sandbox';
      const rows = boundOrder.all(detail, `%; ${detail}`, only, only) as { customer: unknown }[];
      return soleCustomer(rows.map((r) => r.customer));
    },

    list(limit) {
      return (latest.all(limit) as unknown as StateRow[]).map(toEntry);
    },

    // Recomputes every hash from the stored content and follows the links from the first row, then
    // checks that no row after the last one was deleted. One read transaction, so rows another
    // process appends meanwhile are not half seen.
    verifyChain(reuseFullCheckMs = 0, now = Date.now()) {
      db.exec('BEGIN');
      try {
        return check(reuseFullCheckMs, now);
      } finally {
        db.exec('COMMIT');
      }
    },
  };
}
