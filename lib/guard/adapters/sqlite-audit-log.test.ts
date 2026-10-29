import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
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

  it('reports the newest rows as removed when the end of the log was deleted', async () => {
    const { second } = await sample();
    tamper(`DELETE FROM audit_log WHERE id = ${second}`);
    expect(file.verifyChain()).toEqual({ intact: false, brokenAt: second, reason: 'is missing: the newest rows were removed' });
  });

  it('still reports the removed newest rows after a later row is appended', async () => {
    const { second } = await sample();
    tamper(`DELETE FROM audit_log WHERE id = ${second}`);
    await file.record(entry());
    expect(file.verifyChain()).toEqual({ intact: false, brokenAt: second, reason: 'is missing: a row was removed' });
  });

  it('still reports an emptied log after a later row is appended', async () => {
    await sample();
    tamper(`DELETE FROM audit_log`);
    await file.record(entry());
    expect(file.verifyChain()).toMatchObject({ intact: false, brokenAt: '1' });
  });

  it('reports a log emptied after rows were written', async () => {
    await sample();
    tamper(`DELETE FROM audit_log`);
    expect(file.verifyChain()).toMatchObject({ intact: false, brokenAt: '1' });
  });

  it('keeps one unbroken chain when several processes append to the same file at once', async () => {
    file.verifyChain();
    const child = join(dir, 'append.mjs');
    writeFileSync(
      child,
      `const { createSqliteAuditLog } = await import(process.argv[2]);
       const log = createSqliteAuditLog(process.argv[3]);
       for (let i = 0; i < 40; i++) await log.record(${JSON.stringify(entry())});`,
    );
    const adapter = join(import.meta.dirname, 'sqlite-audit-log.ts');
    const run = () =>
      new Promise<number | null>((resolve) => spawn(process.execPath, ['--no-warnings', child, adapter, path], { stdio: 'inherit' }).on('exit', resolve));
    expect(await Promise.all([run(), run(), run()])).toEqual([0, 0, 0]);
    expect(file.verifyChain()).toMatchObject({ intact: true, records: 120 });
  }, 30_000);

  describe('reusing a recent full check', () => {
    it('still checks rows added since, and counts every row', async () => {
      await sample();
      file.verifyChain(60_000, 0);
      await file.record(entry());
      expect(file.verifyChain(60_000, 1_000)).toMatchObject({ intact: true, records: 4 });
      const added = await file.record(entry());
      tamper(`UPDATE audit_log SET moved_minor = 1 WHERE id = ${added}`);
      expect(file.verifyChain(60_000, 2_000)).toMatchObject({ intact: false, brokenAt: added });
    });

    it('checks the whole chain again once the full check is older than the window', async () => {
      const { first } = await sample();
      file.verifyChain(60_000, 0);
      tamper(`UPDATE audit_log SET moved_minor = 1 WHERE id = ${first}`);
      expect(file.verifyChain(60_000, 61_000)).toMatchObject({ intact: false, brokenAt: first });
    });

    it('checks the whole chain again when the last verified row changed', async () => {
      await sample();
      file.verifyChain(60_000, 0);
      tamper(`UPDATE audit_log SET hash = '${'f'.repeat(64)}' WHERE id = (SELECT MAX(id) FROM audit_log)`);
      expect(file.verifyChain(60_000, 1_000).intact).toBe(false);
    });
  });

  describe('a log written before the chain (table `audit`)', () => {
    const legacy = (withResolves: boolean) => {
      tamper(`
        DROP TABLE IF EXISTS audit;
        CREATE TABLE audit (id INTEGER PRIMARY KEY AUTOINCREMENT, at TEXT NOT NULL, tool TEXT NOT NULL, args TEXT NOT NULL,
          task TEXT NOT NULL, decision TEXT NOT NULL, moved_minor INTEGER, moved_currency TEXT, outcome TEXT NOT NULL, detail TEXT
          ${withResolves ? ', resolves INTEGER' : ''});
        INSERT INTO audit (id, at, tool, args, task, decision, moved_minor, moved_currency, outcome, detail${withResolves ? ', resolves' : ''}) VALUES
          (3, '2026-10-20T09:00:00.000Z', 'create_refund', '{"capture_id":"CAP-1"}', '${JSON.stringify(task)}', '{"verdict":"allow","violations":[]}', 2500, 'USD', 'pending', NULL${withResolves ? ', NULL' : ''}),
          (7, '2026-10-20T09:05:00.000Z', 'create_refund', '{"capture_id":"CAP-2"}', '${JSON.stringify(task)}', '{"verdict":"hold","violations":[]}', NULL, NULL, 'held', NULL${withResolves ? ', NULL' : ''}),
          (9, '2026-10-20T09:10:00.000Z', 'create_refund', '{"capture_id":"CAP-2"}', '${JSON.stringify(task)}', '{"verdict":"block","violations":[]}', NULL, NULL, 'blocked', 'no'${withResolves ? ', 7' : ''});
      `);
    };

    it('carries its rows into the chain, renumbered without gaps, so limits and decisions keep counting them', async () => {
      tamper('DROP TABLE audit_log; DROP VIEW audit_state;');
      legacy(true);
      const upgraded = createSqliteAuditLog(path);
      expect(upgraded.list(10).map((e) => [e.id, e.outcome, e.resolves])).toEqual([['3', 'blocked', '2'], ['2', 'held', undefined], ['1', 'pending', undefined]]);
      expect(await upgraded.hasUnsettledRefund('CAP-1')).toBe(true);
      expect(await upgraded.movedSince(new Date('2026-10-20T00:00:00.000Z'), 'USD')).toEqual({ minor: 2500, currency: 'USD' });
      expect(await upgraded.isResolved('2')).toBe(true);
      expect(await upgraded.record(entry())).toBe('4');
      expect(upgraded.verifyChain()).toMatchObject({ intact: true, records: 4 });
    });

    it('carries a log that predates approvals, which has no resolves column', async () => {
      tamper('DROP TABLE audit_log; DROP VIEW audit_state;');
      legacy(false);
      expect(createSqliteAuditLog(path).list(10)).toHaveLength(3);
    });

    it('carries the rows once, not again on every open', async () => {
      tamper('DROP TABLE audit_log; DROP VIEW audit_state;');
      legacy(true);
      createSqliteAuditLog(path);
      expect(createSqliteAuditLog(path).verifyChain()).toMatchObject({ intact: true, records: 3 });
    });
  });
});
