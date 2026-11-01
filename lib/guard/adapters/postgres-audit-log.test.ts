import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Db } from '@/lib/db/db';
import { migrate } from '@/lib/db/migrations';
import { createPgliteDb } from '@/lib/db/pglite';
import type { AuditEntry, BlackBox } from '../ports';
import { createPostgresAuditLog } from './postgres-audit-log';
import { createSqliteAuditLog } from './sqlite-audit-log';

// The same behaviour as the SQLite black box (sqlite-audit-log.test.ts), on an in-process Postgres
// (PGlite): no server, no Neon.

const task = { mandate: { customerEmail: 'ana@example.com' }, instructions: 'Refund damaged items only.', untrustedInput: 'Broken mug.' };

const entry = (overrides: Partial<AuditEntry> = {}): AuditEntry => ({
  at: '2026-10-20T10:00:00.000Z',
  tool: 'create_refund',
  args: { capture_id: 'CAP-1' },
  task,
  decision: { verdict: 'allow', violations: [] },
  outcome: 'pending',
  moved: { minor: 2500, currency: 'USD' },
  ...overrides,
});

let db: Db;
let log: BlackBox;

beforeEach(async () => {
  db = await createPgliteDb();
  await migrate(db);
  log = createPostgresAuditLog(db);
});

afterEach(() => db.close());

describe('postgres audit log', () => {
  it('stores entries and lists them newest first with every field', async () => {
    await log.record(entry());
    const blocked = entry({
      at: '2026-10-20T11:00:00.000Z',
      outcome: 'blocked',
      moved: undefined,
      decision: { verdict: 'block', violations: [{ code: 'DAILY_LIMIT', message: 'over' }] },
    });
    await log.record(blocked);
    const rows = await log.list(10);
    expect(rows.map((r) => r.outcome)).toEqual(['blocked', 'pending']);
    expect(rows[0]).toMatchObject({ ...blocked, id: '2' });
    expect(rows[0].moved).toBeUndefined();
    expect(rows[1].moved).toEqual({ minor: 2500, currency: 'USD' });
  });

  it('sums money moved since a date in one currency, counting pending entries', async () => {
    await log.record(entry({ at: '2026-10-19T23:59:59.000Z' }));
    await log.record(entry());
    await log.record(entry({ outcome: 'executed', moved: { minor: 1000, currency: 'USD' } }));
    await log.record(entry({ moved: { minor: 9999, currency: 'EUR' } }));
    expect(await log.movedSince(new Date('2026-10-20T00:00:00Z'), 'USD')).toEqual({ minor: 3500, currency: 'USD' });
    expect(await log.movedSince(new Date('2026-10-20T00:00:00Z'), 'GBP')).toEqual({ minor: 0, currency: 'GBP' });
  });

  it('keeps invoices out of the money refunded, and sums them apart as money billed', async () => {
    const invoice = (overrides: Partial<AuditEntry> = {}) => entry({ tool: 'create_invoice', args: { currency_code: 'USD' }, moved: { minor: 4000, currency: 'USD' }, ...overrides });
    await log.record(entry());
    await log.record(invoice());
    await log.record(invoice({ outcome: 'executed', moved: { minor: 1000, currency: 'USD' } }));
    await log.record(invoice({ at: '2026-10-19T23:59:59.000Z' }));
    await log.record(invoice({ moved: { minor: 9999, currency: 'EUR' } }));
    await log.record(invoice({ outcome: 'held', moved: undefined }));
    const rejected = await log.record(invoice());
    await log.update(rejected, { outcome: 'error', moved: undefined });
    const since = new Date('2026-10-20T00:00:00Z');
    expect(await log.movedSince(since, 'USD')).toEqual({ minor: 2500, currency: 'USD' });
    expect(await log.billedSince(since, 'USD')).toEqual({ minor: 5000, currency: 'USD' });
    expect(await log.billedSince(since, 'GBP')).toEqual({ minor: 0, currency: 'GBP' });
  });

  it('keeps orders out of both the money refunded and the money billed: creating an order moves no money', async () => {
    await log.record(entry());
    await log.record(entry({ tool: 'create_order', args: { currencyCode: 'USD' }, outcome: 'executed', moved: { minor: 9998, currency: 'USD' } }));
    const since = new Date('2026-10-20T00:00:00Z');
    expect(await log.movedSince(since, 'USD')).toEqual({ minor: 2500, currency: 'USD' });
    expect(await log.billedSince(since, 'USD')).toEqual({ minor: 0, currency: 'USD' });
  });

  it('keeps the amount when an update omits it', async () => {
    const id = await log.record(entry());
    await log.update(id, { outcome: 'executed' });
    expect((await log.list(1))[0]).toMatchObject({ outcome: 'executed', moved: { minor: 2500, currency: 'USD' } });
  });

  it('clears the amount when an update sets it to undefined explicitly', async () => {
    const id = await log.record(entry());
    await log.update(id, { outcome: 'error', moved: undefined });
    expect((await log.list(1))[0].moved).toBeUndefined();
    expect(await log.movedSince(new Date('2026-10-20T00:00:00Z'), 'USD')).toEqual({ minor: 0, currency: 'USD' });
  });

  it('stores a detail message on update', async () => {
    const id = await log.record(entry());
    await log.update(id, { outcome: 'error', detail: 'socket hang up' });
    expect((await log.list(1))[0]).toMatchObject({ outcome: 'error', detail: 'socket hang up' });
  });

  it('reports an unsettled refund of a capture: pending, or failed with its amount still counting', async () => {
    expect(await log.hasUnsettledRefund('CAP-1')).toBe(false);
    const id = await log.record(entry());
    expect(await log.hasUnsettledRefund('CAP-1')).toBe(true);
    expect(await log.hasUnsettledRefund('CAP-2')).toBe(false);
    await log.update(id, { outcome: 'error', detail: 'timed out' });
    expect(await log.hasUnsettledRefund('CAP-1')).toBe(true);
  });

  it('treats executed, blocked and explicitly rejected refunds as settled', async () => {
    await log.record(entry({ outcome: 'executed' }));
    await log.record(entry({ outcome: 'blocked', moved: undefined }));
    const id = await log.record(entry());
    await log.update(id, { outcome: 'error', moved: undefined });
    await log.record(entry({ tool: 'get_order', args: { capture_id: 'CAP-1' } }));
    expect(await log.hasUnsettledRefund('CAP-1')).toBe(false);
  });

  it('reads one entry by id, and tells whether a later entry resolves a held one', async () => {
    const held = entry({ outcome: 'held', moved: undefined, decision: { verdict: 'hold', violations: [{ code: 'APPROVAL_REQUIRED', message: 'over' }] } });
    const heldId = await log.record(held);
    expect(await log.get(heldId)).toEqual({ ...held, id: heldId, environment: 'sandbox' });
    expect(await log.get('999')).toBeUndefined();
    expect(await log.isResolved(heldId)).toBe(false);

    const approvalId = await log.record(entry({ resolves: heldId, outcome: 'executed' }));
    expect(await log.isResolved(heldId)).toBe(true);
    expect((await log.get(approvalId))?.resolves).toBe(heldId);
  });

  it('names the customer the guard bound a created order to, and nobody for any other order', async () => {
    const ORDER = '5O190127TN364715T';
    const created = (overrides: Partial<AuditEntry> = {}) => entry({ tool: 'create_order', args: { currencyCode: 'USD' }, moved: undefined, outcome: 'pending', ...overrides });
    expect(await log.boundOrderCustomer(ORDER)).toBeUndefined();

    const id = await log.record(created());
    await log.update(id, { outcome: 'executed' });
    expect(await log.boundOrderCustomer(ORDER)).toBeUndefined();
    await log.update(id, { detail: `Order ${ORDER} bound to the task customer` });
    expect(await log.boundOrderCustomer(ORDER)).toBe('ana@example.com');
    expect(await log.boundOrderCustomer('9X190127TN364715T')).toBeUndefined();

    // Bound after the guard's timeout: PayPal answered late and the binding followed.
    const late = await log.record(created({ task: { ...task, mandate: { customerEmail: 'ben@example.com' } } }));
    await log.update(late, { outcome: 'executed', detail: 'PayPal completed the call after the guard timed out; Order 7A190127TN364715T bound to the task customer' });
    expect(await log.boundOrderCustomer('7A190127TN364715T')).toBe('ben@example.com');

    // Created but not bound, failed, or not a create_order: no customer.
    const unbound = await log.record(created({ outcome: 'executed', detail: 'Order 8B190127TN364715T was created in PayPal but not bound to the task customer: PayPal 500' }));
    expect(unbound).toBeTruthy();
    expect(await log.boundOrderCustomer('8B190127TN364715T')).toBeUndefined();
    await log.record(created({ outcome: 'error', detail: 'Order 6C190127TN364715T bound to the task customer' }));
    expect(await log.boundOrderCustomer('6C190127TN364715T')).toBeUndefined();
    await log.record(entry({ outcome: 'executed', detail: 'Order 5D190127TN364715T bound to the task customer' }));
    expect(await log.boundOrderCustomer('5D190127TN364715T')).toBeUndefined();
  });
});

describe('the PayPal environment of each decision', () => {
  it('records sandbox when the caller names none, and live when it says so', async () => {
    const sandbox = await log.record(entry());
    const live = await log.record(entry({ environment: 'live' }));
    expect((await log.get(sandbox))?.environment).toBe('sandbox');
    expect((await log.get(live))?.environment).toBe('live');
    expect((await log.list(2)).map((e) => e.environment)).toEqual(['live', 'sandbox']);
  });
});

describe('hash-chained black box on Postgres', () => {
  // What someone with access to the database could do behind the guard's back.
  const tamper = (sql: string) => db.query(sql);

  async function sample() {
    const first = await log.record(entry());
    await log.update(first, { outcome: 'executed' });
    const second = await log.record(entry({ outcome: 'blocked', moved: undefined, decision: { verdict: 'block', violations: [{ code: 'DAILY_LIMIT', message: 'over' }] } }));
    return { first, second };
  }

  it('verifies an untouched log, counting every record and settlement', async () => {
    await sample();
    expect(await log.verifyChain()).toEqual({ intact: true, records: 3, head: expect.stringMatching(/^[0-9a-f]{64}$/) });
  });

  it('verifies an empty log', async () => {
    expect(await log.verifyChain()).toEqual({ intact: true, records: 0, head: null });
  });

  it('appends a settlement instead of rewriting the logged call', async () => {
    const id = await log.record(entry());
    const row = () => db.query('SELECT * FROM guard.audit_log WHERE id = $1', [Number(id)]).then((r) => r.rows[0]);
    const before = await row();
    await log.update(id, { outcome: 'executed', detail: 'done' });
    expect(await row()).toEqual(before);
    expect((await db.query('SELECT COUNT(*)::int AS n FROM guard.audit_log')).rows[0].n).toBe(2);
    expect(await log.list(10)).toHaveLength(1);
    expect((await log.list(1))[0]).toMatchObject({ id, outcome: 'executed', detail: 'done', moved: { minor: 2500, currency: 'USD' } });
  });

  it('reports the first record whose content was changed', async () => {
    const { first } = await sample();
    await tamper(`UPDATE guard.audit_log SET args = '{"capture_id":"CAP-EVIL"}' WHERE id = ${first}`);
    expect(await log.verifyChain()).toMatchObject({ intact: false, brokenAt: first });
  });

  it('reports a change to an amount', async () => {
    const { first } = await sample();
    await tamper(`UPDATE guard.audit_log SET moved_minor = 1 WHERE id = ${first}`);
    expect(await log.verifyChain()).toMatchObject({ intact: false, brokenAt: first });
  });

  it('reports a change to the environment a decision ran in', async () => {
    const { first } = await sample();
    await tamper(`UPDATE guard.audit_log SET environment = 'live' WHERE id = ${first}`);
    expect(await log.verifyChain()).toMatchObject({ intact: false, brokenAt: first });
  });

  it('reports a deleted record at the record that followed it', async () => {
    const { first, second } = await sample();
    await tamper(`DELETE FROM guard.audit_log WHERE id = ${first}`);
    const result = await log.verifyChain();
    expect(result.intact).toBe(false);
    expect(Number(result.intact ? 0 : result.brokenAt)).toBeGreaterThan(Number(first));
    expect(Number(result.intact ? 0 : result.brokenAt)).toBeLessThanOrEqual(Number(second));
  });

  it('reports rows swapped into another order', async () => {
    const { first, second } = await sample();
    await tamper(`UPDATE guard.audit_log SET id = -1 WHERE id = ${first}`);
    await tamper(`UPDATE guard.audit_log SET id = ${first} WHERE id = ${second}`);
    await tamper(`UPDATE guard.audit_log SET id = ${second} WHERE id = -1`);
    expect(await log.verifyChain()).toMatchObject({ intact: false, brokenAt: first });
  });

  it('reports a record whose hash was recomputed but whose link no longer matches', async () => {
    const { second } = await sample();
    await tamper(`UPDATE guard.audit_log SET prev_hash = '${'0'.repeat(64)}' WHERE id = ${second}`);
    expect(await log.verifyChain()).toMatchObject({ intact: false, brokenAt: second });
  });

  it('stays intact when a stored text holds a malformed character or a NUL, which Postgres cannot store as given', async () => {
    const id = await log.record(entry({ detail: 'socket \ud800 closed\u0000' }));
    await log.update(id, { outcome: 'error', detail: 'bad \udfff' });
    expect(await log.verifyChain()).toMatchObject({ intact: true, records: 2 });
  });

  it('keeps the chain across a new adapter on the same database (a restart)', async () => {
    await sample();
    const restarted = createPostgresAuditLog(db);
    await restarted.record(entry());
    expect(await restarted.verifyChain()).toMatchObject({ intact: true, records: 4 });
  });

  it('reports the newest rows as removed when the end of the log was deleted', async () => {
    const { second } = await sample();
    await tamper(`DELETE FROM guard.audit_log WHERE id = ${second}`);
    expect(await log.verifyChain()).toEqual({ intact: false, brokenAt: second, reason: 'is missing: the newest rows were removed' });
  });

  it('still reports the removed newest rows after a later row is appended', async () => {
    const { second } = await sample();
    await tamper(`DELETE FROM guard.audit_log WHERE id = ${second}`);
    await log.record(entry());
    expect(await log.verifyChain()).toEqual({ intact: false, brokenAt: second, reason: 'is missing: a row was removed' });
  });

  it('still reports an emptied log after a later row is appended', async () => {
    await sample();
    await tamper(`DELETE FROM guard.audit_log`);
    await log.record(entry());
    expect(await log.verifyChain()).toMatchObject({ intact: false, brokenAt: '1' });
  });

  it('reports a log emptied after rows were written', async () => {
    await sample();
    await tamper(`DELETE FROM guard.audit_log`);
    expect(await log.verifyChain()).toMatchObject({ intact: false, brokenAt: '1' });
  });

  it('keeps one unbroken chain when many appends race', async () => {
    await Promise.all(Array.from({ length: 30 }, () => log.record(entry())));
    expect(await log.verifyChain()).toMatchObject({ intact: true, records: 30 });
  });

  it('gives a failed append no id, so the next one leaves no gap', async () => {
    await log.record(entry());
    await expect(log.record(entry({ resolves: 'not-a-number' }))).rejects.toThrow();
    expect(await log.record(entry())).toBe('2');
    expect(await log.verifyChain()).toMatchObject({ intact: true, records: 2 });
  });

  it('hashes a record exactly as the SQLite black box does, so a copied log keeps its hashes', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'guard-audit-pg-'));
    try {
      const path = join(dir, 'audit.db');
      const decided = entry({ environment: 'live', detail: 'socket \ud800 closed' });
      await createSqliteAuditLog(path).record(decided);
      await log.record(decided);
      const sqliteHash = (new DatabaseSync(path).prepare('SELECT hash FROM audit_log WHERE id = 1').get() as { hash: string }).hash;
      const pgHash = (await db.query<{ hash: string }>('SELECT hash FROM guard.audit_log WHERE id = 1')).rows[0].hash;
      expect(pgHash).toBe(sqliteHash);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  describe('reusing a recent full check', () => {
    it('still checks rows added since, and counts every row', async () => {
      await sample();
      await log.verifyChain(60_000, 0);
      await log.record(entry());
      expect(await log.verifyChain(60_000, 1_000)).toMatchObject({ intact: true, records: 4 });
      const added = await log.record(entry());
      await tamper(`UPDATE guard.audit_log SET moved_minor = 1 WHERE id = ${added}`);
      expect(await log.verifyChain(60_000, 2_000)).toMatchObject({ intact: false, brokenAt: added });
    });

    it('checks the whole chain again once the full check is older than the window', async () => {
      const { first } = await sample();
      await log.verifyChain(60_000, 0);
      await tamper(`UPDATE guard.audit_log SET moved_minor = 1 WHERE id = ${first}`);
      expect(await log.verifyChain(60_000, 61_000)).toMatchObject({ intact: false, brokenAt: first });
    });

    it('checks the whole chain again when the last verified row changed', async () => {
      await sample();
      await log.verifyChain(60_000, 0);
      await tamper(`UPDATE guard.audit_log SET hash = '${'f'.repeat(64)}' WHERE id = (SELECT MAX(id) FROM guard.audit_log)`);
      expect((await log.verifyChain(60_000, 1_000)).intact).toBe(false);
    });
  });
});
