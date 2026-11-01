import { describe, expect, it } from 'vitest';
import { inEnvironment } from './environment-audit';
import type { AuditEntry, AuditLog } from './ports';

const entry = (overrides: Partial<AuditEntry> = {}): AuditEntry => ({
  at: '2026-11-01T10:00:00.000Z',
  tool: 'create_refund',
  args: {},
  task: { mandate: { customerEmail: 'ana@example.com' }, instructions: 'x', untrustedInput: 'y' },
  decision: { verdict: 'allow', violations: [] },
  outcome: 'pending',
  ...overrides,
});

function fakeLog() {
  const recorded: AuditEntry[] = [];
  const log: AuditLog = {
    record: async (e) => (recorded.push(e), String(recorded.length)),
    update: async () => undefined,
    movedSince: async (_since, currency) => ({ minor: 7, currency }),
    billedSince: async (_since, currency) => ({ minor: 3, currency }),
    hasUnsettledRefund: async () => true,
    get: async () => undefined,
    isResolved: async () => true,
    boundOrderCustomer: async () => 'ana@example.com',
  };
  return { log, recorded };
}

describe('inEnvironment', () => {
  it.each(['sandbox', 'live'] as const)('records every entry as run in %s', async (environment) => {
    const { log, recorded } = fakeLog();
    const audit = inEnvironment(log, environment);
    await audit.record(entry());
    await audit.record(entry({ outcome: 'blocked' }));
    expect(recorded.map((e) => e.environment)).toEqual([environment, environment]);
  });

  it('overrides an environment an entry claims for itself', async () => {
    const { log, recorded } = fakeLog();
    await inEnvironment(log, 'sandbox').record(entry({ environment: 'live' }));
    expect(recorded[0].environment).toBe('sandbox');
  });

  it('passes every other call through', async () => {
    const { log } = fakeLog();
    const audit = inEnvironment(log, 'live');
    expect(await audit.movedSince(new Date(), 'USD')).toEqual({ minor: 7, currency: 'USD' });
    expect(await audit.billedSince(new Date(), 'USD')).toEqual({ minor: 3, currency: 'USD' });
    expect(await audit.hasUnsettledRefund('CAP-1')).toBe(true);
    expect(await audit.isResolved('1')).toBe(true);
    expect(await audit.boundOrderCustomer('ORDER')).toBe('ana@example.com');
  });
});
