import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { AuditEntry } from '../ports';
import { createSqliteAuditLog, type SqliteAuditLog } from './sqlite-audit-log';

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

let log: SqliteAuditLog;

beforeEach(() => {
  log = createSqliteAuditLog(':memory:');
});

describe('sqlite audit log', () => {
  it('stores entries and lists them newest first with every field', async () => {
    await log.record(entry());
    const blocked = entry({
      at: '2026-10-20T11:00:00.000Z',
      outcome: 'blocked',
      moved: undefined,
      decision: { verdict: 'block', violations: [{ code: 'DAILY_LIMIT', message: 'over' }] },
    });
    await log.record(blocked);
    const rows = log.list(10);
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

  it('keeps the amount when an update omits it', async () => {
    const id = await log.record(entry());
    await log.update(id, { outcome: 'executed' });
    expect(log.list(1)[0]).toMatchObject({ outcome: 'executed', moved: { minor: 2500, currency: 'USD' } });
  });

  it('clears the amount when an update sets it to undefined explicitly', async () => {
    const id = await log.record(entry());
    await log.update(id, { outcome: 'error', moved: undefined });
    expect(log.list(1)[0].moved).toBeUndefined();
    expect(await log.movedSince(new Date('2026-10-20T00:00:00Z'), 'USD')).toEqual({ minor: 0, currency: 'USD' });
  });

  it('stores a detail message on update', async () => {
    const id = await log.record(entry());
    await log.update(id, { outcome: 'error', detail: 'socket hang up' });
    expect(log.list(1)[0]).toMatchObject({ outcome: 'error', detail: 'socket hang up' });
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
    expect(await log.get(heldId)).toEqual({ ...held, id: heldId });
    expect(await log.get('999')).toBeUndefined();
    expect(await log.isResolved(heldId)).toBe(false);

    const approvalId = await log.record(entry({ resolves: heldId, outcome: 'executed' }));
    expect(await log.isResolved(heldId)).toBe(true);
    expect((await log.get(approvalId))?.resolves).toBe(heldId);
  });
});

describe('hash-chained black box', () => {
  let dir: string;
  let path: string;
  let file: SqliteAuditLog;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'guard-audit-'));
    path = join(dir, 'audit.db');
    file = createSqliteAuditLog(path);
  });

  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  // What someone with access to the database file could do behind the guard's back.
  const tamper = (sql: string) => {
    const db = new DatabaseSync(path);
    db.exec(sql);
    db.close();
  };

  async function sample() {
    const first = await file.record(entry());
    await file.update(first, { outcome: 'executed' });
    const second = await file.record(entry({ outcome: 'blocked', moved: undefined, decision: { verdict: 'block', violations: [{ code: 'DAILY_LIMIT', message: 'over' }] } }));
    return { first, second };
  }

  it('verifies an untouched log, counting every record and settlement', async () => {
    await sample();
    expect(file.verifyChain()).toEqual({ intact: true, records: 3, head: expect.stringMatching(/^[0-9a-f]{64}$/) });
  });

  it('verifies an empty log', () => {
    expect(file.verifyChain()).toEqual({ intact: true, records: 0, head: null });
  });

  it('appends a settlement instead of rewriting the logged call', async () => {
    const id = await file.record(entry());
    const before = new DatabaseSync(path).prepare('SELECT * FROM audit_log WHERE id = ?').get(Number(id));
    await file.update(id, { outcome: 'executed', detail: 'done' });
    const db = new DatabaseSync(path);
    expect(db.prepare('SELECT * FROM audit_log WHERE id = ?').get(Number(id))).toEqual(before);
    expect((db.prepare('SELECT COUNT(*) AS n FROM audit_log').get() as { n: number }).n).toBe(2);
    expect(file.list(10)).toHaveLength(1);
    expect(file.list(1)[0]).toMatchObject({ id, outcome: 'executed', detail: 'done', moved: { minor: 2500, currency: 'USD' } });
  });

  it('reports the first record whose content was changed', async () => {
    const { first } = await sample();
    tamper(`UPDATE audit_log SET args = '{"capture_id":"CAP-EVIL"}' WHERE id = ${first}`);
    expect(file.verifyChain()).toMatchObject({ intact: false, brokenAt: first });
  });

  it('reports a change to an amount', async () => {
    const { first } = await sample();
    tamper(`UPDATE audit_log SET moved_minor = 1 WHERE id = ${first}`);
    expect(file.verifyChain()).toMatchObject({ intact: false, brokenAt: first });
  });

  it('reports a deleted record at the record that followed it', async () => {
    const { first, second } = await sample();
    tamper(`DELETE FROM audit_log WHERE id = ${first}`);
    const result = file.verifyChain();
    expect(result.intact).toBe(false);
    expect(Number(result.intact ? 0 : result.brokenAt)).toBeGreaterThan(Number(first));
    expect(Number(result.intact ? 0 : result.brokenAt)).toBeLessThanOrEqual(Number(second));
  });

  it('reports a record whose hash was recomputed but whose link no longer matches', async () => {
    const { second } = await sample();
    tamper(`UPDATE audit_log SET prev_hash = '${'0'.repeat(64)}' WHERE id = ${second}`);
    expect(file.verifyChain()).toMatchObject({ intact: false, brokenAt: second });
  });

  it('stays intact when a stored text holds a malformed character, which SQLite rewrites on insert', async () => {
    const id = await file.record(entry({ detail: 'socket \ud800 closed' }));
    await file.update(id, { outcome: 'error', detail: 'bad \udfff' });
    expect(file.verifyChain()).toMatchObject({ intact: true, records: 2 });
  });

  it('keeps the chain across reopening the file', async () => {
    await sample();
    const reopened = createSqliteAuditLog(path);
    await reopened.record(entry());
    expect(reopened.verifyChain()).toMatchObject({ intact: true, records: 4 });
  });
});
