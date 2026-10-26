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
        agent: 'support',
        action: 'refund',
        billed: 0,
        allowed: 1,
        held: 0,
        blocked: 0,
      },
    ]);
  });

  it('names the agent behind each call: invoice tools belong to the billing agent, the rest to support', () => {
    const agents = ['create_invoice', 'send_invoice', 'send_invoice_reminder', 'get_invoice', 'create_refund', 'accept_dispute_claim', 'cancel_subscription', 'get_order'].map(
      (tool, i) => guardDashboardRows([row({ id: String(i), tool, moved: undefined })]).guardDecisions[0].agent,
    );
    expect(agents).toEqual(['billing', 'billing', 'billing', 'billing', 'support', 'support', 'support', 'support']);
  });

  it('counts each decision once under its verdict, so charts can stack allowed, held and blocked', () => {
    const verdicts = (['allow', 'hold', 'block'] as const).map(
      (verdict, i) => guardDashboardRows([row({ id: String(i), decision: { verdict, violations: [] }, moved: undefined })]).guardDecisions[0],
    );
    expect(verdicts.map(({ allowed, held, blocked }) => [allowed, held, blocked])).toEqual([
      [1, 0, 0],
      [0, 1, 0],
      [0, 0, 1],
    ]);
  });

  it('names what kind of action each call was', () => {
    const tools = [
      'create_refund',
      'accept_dispute_claim',
      'cancel_subscription',
      'create_invoice',
      'send_invoice',
      'send_invoice_reminder',
      'get_order',
      'show_subscription_details',
      'get_dispute',
      'get_invoice',
      'list_products',
    ];
    const actions = tools.map((tool, i) => guardDashboardRows([row({ id: String(i), tool, moved: undefined })]).guardDecisions[0].action);
    expect(actions).toEqual(['refund', 'dispute acceptance', 'cancellation', 'invoice', 'invoice sending', 'reminder', 'read', 'read', 'read', 'read', 'other']);
  });

  it('counts the recorded amount of a blocked dispute acceptance as money protected', () => {
    const blocked = row({
      id: '10',
      tool: 'accept_dispute_claim',
      args: { dispute_id: 'PP-D-1', note: 'ok' },
      decision: { verdict: 'block', violations: [{ code: 'PER_REFUND_LIMIT', message: 'over' }] },
      outcome: 'blocked',
      moved: { minor: 7000, currency: 'USD' },
    });
    expect(guardDashboardRows([blocked]).guardDecisions[0]).toMatchObject({ protected: 70, requested: null });
  });

  it('leaves a blocked dispute acceptance with no recorded amount at zero protected instead of guessing', () => {
    const blocked = row({ id: '11', tool: 'accept_dispute_claim', args: { dispute_id: 'PP-D-1', note: 'ok' }, decision: { verdict: 'block', violations: [] }, outcome: 'blocked', moved: undefined });
    expect(guardDashboardRows([blocked]).guardDecisions[0].protected).toBe(0);
  });

  it('counts an allowed dispute acceptance as money moved, not protected', () => {
    const accepted = row({ id: '12', tool: 'accept_dispute_claim', args: { dispute_id: 'PP-D-1', note: 'ok' }, moved: { minor: 7000, currency: 'USD' } });
    expect(guardDashboardRows([accepted]).guardDecisions[0]).toMatchObject({ moved: 70, protected: 0 });
  });

  it('counts an executed invoice total as billed, and anything else as nothing billed', () => {
    const invoice = (id: string, outcome: AuditRow['outcome'], tool = 'create_invoice') =>
      row({ id, tool, args: { currency_code: 'USD' }, outcome, moved: { minor: 4000, currency: 'USD' } });
    const rows = guardDashboardRows([invoice('a', 'executed'), invoice('b', 'pending'), invoice('c', 'held'), invoice('d', 'executed', 'send_invoice'), row({ id: 'e' })]).guardDecisions;
    expect(rows.map((r) => r.billed)).toEqual([40, 0, 0, 0, 0]);
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
      { id: '7-0', decisionId: '7', code: 'CUSTOMER_MISMATCH', reason: 'Customer mismatch', message: 'Order is not one of the ticket customer a***@example.com' },
      { id: '7-1', decisionId: '7', code: 'DAILY_LIMIT', reason: 'Daily limit', message: 'over' },
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
