// The guard's black box on Postgres (Neon in production): the same append-only, hash-chained log
// as the SQLite adapter (./sqlite-audit-log.ts), with the same row format and hashes
// (./audit-chain.ts). A decision appends a record and its outcome appends a settlement; nothing
// written is ever rewritten. Appends lock the one audit_head row first, so requests and server
// processes appending at once still form one chain, and the id counter in that row moves in the
// same transaction, so a failed append leaves no gap and a deleted newest row shows as missing.
// The tables are created by lib/db/migrations.ts.

import type { Db, Queryable } from '../../db/db.ts';
import { schemaName } from '../../db/db.ts';
import type { Money } from '../domain/policy';
import type { BlackBox, ChainCheck } from '../ports';
import { boundOrderDetail, GENESIS, hashOf, ORDER_ID, recordRow, settleRow, soleCustomer, toEntry, type LogRow, type StateRow } from './audit-chain.ts';

const COLUMNS = ['kind', 'at', 'ref', 'tool', 'args', 'task', 'decision', 'moved_minor', 'moved_currency', 'moved_set', 'outcome', 'detail', 'resolves', 'environment'] as const;

// node-postgres returns BIGINT as text; the chain hashes numbers.
const num = (value: unknown) => (value === null || value === undefined ? null : Number(value));

const logRow = (row: Record<string, unknown>): LogRow => ({
  ...(row as LogRow),
  id: Number(row.id),
  ref: num(row.ref),
  moved_minor: num(row.moved_minor),
  moved_set: Number(row.moved_set),
  resolves: num(row.resolves),
});

const stateRow = (row: Record<string, unknown>): StateRow => ({
  ...(row as StateRow),
  id: Number(row.id),
  moved_minor: num(row.moved_minor),
  resolves: num(row.resolves),
});

// Postgres text holds neither lone surrogates (the driver sends them as U+FFFD) nor NUL; store and
// hash the same replacement character for both, so the hash matches what is read back.
const storable = (value: unknown) => (typeof value === 'string' ? value.toWellFormed().replaceAll('\u0000', '�') : value);

export function createPostgresAuditLog(db: Db, { schema = 'guard' }: { schema?: string } = {}): BlackBox {
  const s = schemaName(schema);

  // The last full check, so a later one within the window only reads the rows added since.
  let verified: { id: number; hash: string; records: number; at: number } | undefined;

  async function append(raw: Omit<LogRow, 'id' | 'prev_hash' | 'hash'>): Promise<string> {
    const row = Object.fromEntries(Object.entries(raw).map(([key, value]) => [key, storable(value)])) as typeof raw;
    return db.transaction(async (tx) => {
      // The row lock serializes every append; it is held until this transaction ends.
      const head = await tx.query<{ last_id: unknown }>(`SELECT last_id FROM ${s}.audit_head WHERE singleton FOR UPDATE`);
      if (!head.rows.length) throw new Error(`${s}.audit_head has no row: run the database migrations`);
      const id = Number(head.rows[0].last_id) + 1;
      const last = await tx.query<{ hash: string }>(`SELECT hash FROM ${s}.audit_log ORDER BY id DESC LIMIT 1`);
      const prev_hash = last.rows[0]?.hash ?? GENESIS;
      const hash = hashOf({ ...row, prev_hash });
      const params = [id, ...COLUMNS.map((column) => row[column]), prev_hash, hash];
      await tx.query(
        `INSERT INTO ${s}.audit_log (id, ${COLUMNS.join(', ')}, prev_hash, hash) VALUES (${params.map((_, i) => `$${i + 1}`).join(', ')})`,
        params,
      );
      await tx.query(`UPDATE ${s}.audit_head SET last_id = $1 WHERE singleton`, [id]);
      return String(id);
    });
  }

  // Pending entries count too: their call may have moved money even if it never settled. An
  // invoice's amount is money billed, not refunded, so each sum only sees its own kind of entry;
  // creating an order moves no money (the buyer pays it later, in PayPal), so neither sum sees it.
  async function sum(where: string, since: Date, currency: string): Promise<Money> {
    const { rows } = await db.query<{ total: unknown }>(
      `SELECT COALESCE(SUM(moved_minor), 0) AS total FROM ${s}.audit_state WHERE at >= $1 AND moved_currency = $2 AND ${where}`,
      [since.toISOString(), currency],
    );
    return { minor: Number(rows[0].total), currency };
  }

  async function check(tx: Queryable, reuseFullCheckMs: number, now: number): Promise<ChainCheck> {
    let reuse: typeof verified;
    if (verified && now - verified.at < reuseFullCheckMs) {
      const at = await tx.query<{ hash: string }>(`SELECT hash FROM ${s}.audit_log WHERE id = $1`, [verified.id]);
      if (at.rows[0]?.hash === verified.hash) reuse = verified;
    }
    let prev = reuse?.hash ?? GENESIS;
    let records = reuse?.records ?? 0;
    let last = reuse?.id ?? 0;
    const { rows } = await tx.query(`SELECT * FROM ${s}.audit_log WHERE id > $1 ORDER BY id`, [last]);
    for (const row of rows.map(logRow)) {
      if (row.prev_hash !== prev) return { intact: false, brokenAt: String(row.id), reason: 'does not link to the row before it (a row was removed or altered)' };
      if (hashOf(row) !== row.hash) return { intact: false, brokenAt: String(row.id), reason: 'content does not match its hash (the row was altered)' };
      // Ids are handed out one by one, so a gap is a row deleted from the end before the next append.
      if (row.id !== last + 1) return { intact: false, brokenAt: String(last + 1), reason: 'is missing: a row was removed' };
      prev = row.hash;
      records++;
      last = row.id;
    }
    const head = await tx.query<{ last_id: unknown }>(`SELECT last_id FROM ${s}.audit_head WHERE singleton`);
    const issued = Number(head.rows[0]?.last_id ?? 0);
    if (issued > last) return { intact: false, brokenAt: String(last + 1), reason: 'is missing: the newest rows were removed' };
    if (records) verified = { id: last, hash: prev, records, at: reuse?.at ?? now };
    return { intact: true, records, head: records ? prev : null };
  }

  return {
    async record(entry) {
      return append(recordRow(entry));
    },

    async update(id, patch) {
      const row = settleRow(id, patch, new Date().toISOString());
      if (row) await append(row);
    },

    movedSince: (since, currency) => sum(`COALESCE(tool, '') NOT IN ('create_invoice', 'create_order')`, since, currency),

    billedSince: (since, currency) => sum(`tool = 'create_invoice'`, since, currency),

    // The unsettled refunds are few; their capture id is read from the stored JSON here rather
    // than in SQL, so one row Postgres can't parse as JSON never breaks the check.
    async hasUnsettledRefund(captureId) {
      const { rows } = await db.query<{ args: string }>(
        `SELECT args FROM ${s}.audit_state WHERE tool = 'create_refund' AND moved_minor IS NOT NULL AND outcome IN ('pending', 'error')`,
      );
      return rows.some((row) => {
        try {
          return JSON.parse(row.args)?.capture_id === captureId;
        } catch {
          return false;
        }
      });
    },

    async get(id) {
      if (!/^\d+$/.test(id)) return undefined;
      const { rows } = await db.query(`SELECT * FROM ${s}.audit_state WHERE id = $1`, [Number(id)]);
      return rows[0] && toEntry(stateRow(rows[0]));
    },

    async isResolved(id) {
      if (!/^\d+$/.test(id)) return false;
      const { rows } = await db.query(`SELECT 1 FROM ${s}.audit_log WHERE kind = 'record' AND resolves = $1 LIMIT 1`, [Number(id)]);
      return rows.length > 0;
    },

    // An executed create_order whose detail records the binding, alone or after a late-answer note
    // (executeWrite joins details with '; '). Order ids are [A-Z0-9], so they hold no LIKE wildcard.
    async boundOrderCustomer(orderId, environment) {
      if (!ORDER_ID.test(orderId)) return undefined;
      const detail = boundOrderDetail(orderId);
      const only = environment === undefined ? null : environment === 'live' ? 'live' : 'sandbox';
      const { rows } = await db.query<{ task: string }>(
        `SELECT task FROM ${s}.audit_state WHERE tool = 'create_order' AND outcome = 'executed' AND (detail = $1 OR detail LIKE $2)
           AND ($3::text IS NULL OR COALESCE(environment, 'sandbox') = $3::text)`,
        [detail, `%; ${detail}`, only],
      );
      return soleCustomer(rows.map((row) => JSON.parse(row.task)?.mandate?.customerEmail));
    },

    async list(limit) {
      const { rows } = await db.query(`SELECT * FROM ${s}.audit_state ORDER BY id DESC LIMIT $1`, [limit]);
      return rows.map((row) => toEntry(stateRow(row)));
    },

    // Recomputes every hash from the stored content and follows the links from the first row, then
    // checks that no row after the last one was deleted, all in one snapshot, so rows another
    // process appends meanwhile are not half seen.
    async verifyChain(reuseFullCheckMs = 0, now = Date.now()) {
      return db.transaction(async (tx) => {
        await tx.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
        return check(tx, reuseFullCheckMs, now);
      });
    },
  };
}
