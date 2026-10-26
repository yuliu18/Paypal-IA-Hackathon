import { describe, expect, it, vi } from 'vitest';
import type { AuditRow } from './ports';
import { guardDashboardRows, readGuardDashboardRows } from './dashboard-rows';

const task = { mandate: { customerEmail: 'ana@example.com' }, instructions: 'Refund damaged items only.', untrustedInput: 'Broken mug.' };

const row = (overrides: Partial<AuditRow> & { id: string }): AuditRow => ({
  at: '2026-10-21T10:00:00.000Z',
  tool: 'create_refund',
  args: { capture_id: 'CAP-1', amount: { value: '25.00', currency_code: 'USD' } },
  task,
  decision: { verdict: 'allow', violations: [] },
  outcome: 'executed',
  moved: { minor: 2500, currency: 'USD' },
  ...overrides,
});

describe('guardDashboardRows', () => {
  it('turns each logged call into one decision row with its day, amounts and who decided', () => {
    const { guardDecisions } = guardDashboardRows([row({ id: '1' })]);
    expect(guardDecisions).toEqual([
      {
        id: '1',
        at: '2026-10-21T10:00:00.000Z',
        day: '2026-10-21',
        tool: 'create_refund',
        verdict: 'allow',
        outcome: 'executed',
        customer: 'a***@example.com',
        currency: 'USD',
        requested: 25,
        moved: 25,
        protected: 0,
        awaitingApproval: 0,
        withheld: 0,
        decidedBy: 'guard',
      },
    ]);
  });

  it('shows an invoice as no money moved: it records what it bills, which never left the shop', () => {
    const invoice = row({ id: '8', tool: 'create_invoice', args: { currency_code: 'USD' }, moved: { minor: 4000, currency: 'USD' } });
    expect(guardDashboardRows([invoice]).guardDecisions[0]).toMatchObject({ moved: 0, protected: 0 });
  });

  it('counts the personal data fields a read withheld from the agent', () => {
    const lookup = row({ id: '9', tool: 'get_order', args: { id: 'O-1' }, moved: undefined, detail: 'Withheld from the agent: payment_source, payer, purchase_units[0].custom_id' });
    expect(guardDashboardRows([lookup]).guardDecisions[0].withheld).toBe(3);
  });

  it('counts a blocked refund as money protected and moves nothing', () => {
    const blocked = row({
      id: '2',
      args: { capture_id: 'CAP-1', amount: { value: '500.00', currency_code: 'USD' } },
      decision: { verdict: 'block', violations: [{ code: 'PER_REFUND_LIMIT', message: 'over' }] },
      outcome: 'blocked',
      moved: undefined,
    });
    expect(guardDashboardRows([blocked]).guardDecisions[0]).toMatchObject({ verdict: 'block', requested: 500, moved: 0, protected: 500 });
  });

  it('leaves the requested amount empty for a full refund, whose amount the agent did not state', () => {
    const full = row({ id: '3', args: { capture_id: 'CAP-1' }, decision: { verdict: 'block', violations: [] }, outcome: 'blocked', moved: undefined });
    expect(guardDashboardRows([full]).guardDecisions[0]).toMatchObject({ requested: null, protected: null, currency: null });
  });

  it('leaves a null or blank requested amount empty instead of reading it as zero', () => {
    for (const value of [null, '', '  ']) {
      const blocked = row({ id: '8', args: { capture_id: 'CAP-1', amount: { value, currency_code: 'USD' } }, decision: { verdict: 'block', violations: [] }, outcome: 'blocked', moved: undefined });
      expect(guardDashboardRows([blocked]).guardDecisions[0]).toMatchObject({ requested: null, protected: null });
    }
  });

  it('marks a held refund as awaiting approval until a later entry decides it', () => {
    const held = row({ id: '4', decision: { verdict: 'hold', violations: [] }, outcome: 'held', moved: undefined });
    expect(guardDashboardRows([held]).guardDecisions[0]).toMatchObject({ awaitingApproval: 1, moved: 0, protected: 0 });

    const approval = row({ id: '5', resolves: '4' });
    const rows = guardDashboardRows([approval, held]).guardDecisions;
    expect(rows.find((r) => r.id === '4')?.awaitingApproval).toBe(0);
    expect(rows.find((r) => r.id === '5')?.decidedBy).toBe('person');
  });

  it('does not count a read-only call as money', () => {
    const lookup = row({ id: '6', tool: 'get_order', args: { order_id: 'O-1' }, moved: undefined });
    expect(guardDashboardRows([lookup]).guardDecisions[0]).toMatchObject({ requested: null, moved: 0, protected: 0 });
  });

  it('lists every violation of every decision as its own row', () => {
    const blocked = row({
      id: '7',
      decision: {
        verdict: 'block',
        violations: [
          { code: 'CUSTOMER_MISMATCH', message: 'Order is not one of the ticket customer ana@example.com' },
          { code: 'DAILY_LIMIT', message: 'over' },
        ],
      },
      outcome: 'blocked',
      moved: undefined,
    });
    expect(guardDashboardRows([row({ id: '1' }), blocked]).guardViolations).toEqual([
      { id: '7-0', decisionId: '7', code: 'CUSTOMER_MISMATCH', message: 'Order is not one of the ticket customer a***@example.com' },
      { id: '7-1', decisionId: '7', code: 'DAILY_LIMIT', message: 'over' },
    ]);
  });
});

describe('readGuardDashboardRows', () => {
  it('reads the newest entries up to the limit', () => {
    let asked = 0;
    const rows = readGuardDashboardRows((limit) => {
      asked = limit;
      return [row({ id: '1' })];
    }, 5000);
    expect(asked).toBe(5000);
    expect(rows.guardDecisions).toHaveLength(1);
  });

  it('returns empty tables when the log cannot be read, so the rest of the dashboard still loads', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const rows = readGuardDashboardRows(() => {
      throw new Error('database is locked');
    }, 5000);
    expect(rows).toEqual({ guardDecisions: [], guardViolations: [] });
    expect(error).toHaveBeenCalled();
    error.mockRestore();
  });
});
