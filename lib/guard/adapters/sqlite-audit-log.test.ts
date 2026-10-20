import { beforeEach, describe, expect, it } from 'vitest';
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
});
