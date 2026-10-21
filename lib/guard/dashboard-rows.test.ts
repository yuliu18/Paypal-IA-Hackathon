import { describe, expect, it } from 'vitest';
import type { AuditRow } from './ports';
import { guardDashboardRows } from './dashboard-rows';

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
        customer: 'ana@example.com',
        currency: 'USD',
        requested: 25,
        moved: 25,
        protected: 0,
        awaitingApproval: 0,
        decidedBy: 'guard',
      },
    ]);
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
          { code: 'CUSTOMER_MISMATCH', message: 'other payer' },
          { code: 'DAILY_LIMIT', message: 'over' },
        ],
      },
      outcome: 'blocked',
      moved: undefined,
    });
    expect(guardDashboardRows([row({ id: '1' }), blocked]).guardViolations).toEqual([
      { id: '7-0', decisionId: '7', code: 'CUSTOMER_MISMATCH', message: 'other payer' },
      { id: '7-1', decisionId: '7', code: 'DAILY_LIMIT', message: 'over' },
    ]);
  });
});
