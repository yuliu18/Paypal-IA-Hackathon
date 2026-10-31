import { createTranslator } from 'next-intl';
import { describe, expect, it } from 'vitest';
import en from '@/messages/en/home.json';
import type { GuardDecisionRow, GuardViolationRow } from '@/lib/guard/dashboard-rows';
import { checkpointCalls, timeAgo as timeAgoIn } from './checkpoint';

const english = createTranslator({ locale: 'en', messages: { home: en }, namespace: 'home.checkpoint.timeAgo' });
const timeAgo = (at: string, now: Date) => timeAgoIn(at, now, (key, values) => english(key as Parameters<typeof english>[0], values));

const row = (overrides: Partial<GuardDecisionRow> & { id: string }): GuardDecisionRow => ({
  at: '2026-10-31T10:00:00.000Z',
  day: '2026-10-31',
  tool: 'create_refund',
  verdict: 'allow',
  outcome: 'executed',
  customer: 'a***@example.com',
  currency: 'USD',
  requested: 49.99,
  moved: 49.99,
  protected: null,
  awaitingApproval: 0,
  withheld: 0,
  decidedBy: 'guard',
  agent: 'support',
  action: 'refund',
  billed: 0,
  allowed: 1,
  held: 0,
  blocked: 0,
  decision: 'Allowed',
  ...overrides,
});

describe('checkpointCalls', () => {
  it('lists the newest calls that would change something at PayPal, with the first reason a call was stopped or held', () => {
    const rows = [
      row({ id: '5', action: 'read', tool: 'get_order' }),
      row({ id: '4', decidedBy: 'person', outcome: 'executed' }),
      row({ id: '3', agent: 'sales', action: 'order', tool: 'create_order', outcome: 'blocked', verdict: 'block', requested: 449.1 }),
      row({ id: '2', agent: 'billing', action: 'invoice', tool: 'create_invoice', outcome: 'held', verdict: 'hold', requested: 180 }),
      row({ id: '1' }),
    ];
    const violations: GuardViolationRow[] = [
      { id: '3-0', decisionId: '3', code: 'DISCOUNT_LIMIT', reason: 'Discount limit', message: 'x' },
      { id: '3-1', decisionId: '3', code: 'INTENT_MISMATCH', reason: 'Intent mismatch', message: 'y' },
      { id: '2-0', decisionId: '2', code: 'APPROVAL_REQUIRED', reason: 'Approval required', message: 'z' },
    ];
    expect(checkpointCalls({ guardDecisions: rows, guardViolations: violations }, 2)).toEqual([
      { id: '3', at: rows[2].at, agent: 'Sales', action: 'Order', amount: '449.10 USD', customer: 'a***@example.com', outcome: 'blocked', reason: 'Discount limit' },
      { id: '2', at: rows[3].at, agent: 'Billing', action: 'Invoice', amount: '180.00 USD', customer: 'a***@example.com', outcome: 'held', reason: 'Approval required' },
    ]);
  });

  it('leaves out the amount when the agent stated none, and the reason when the call passed', () => {
    const [call] = checkpointCalls({ guardDecisions: [row({ id: '1', requested: null, currency: null })], guardViolations: [] }, 5);
    expect(call.amount).toBeNull();
    expect(call.reason).toBeNull();
  });
});

describe('timeAgo', () => {
  const now = new Date('2026-10-31T12:00:00.000Z');
  it('says how long ago in the largest whole unit', () => {
    expect(timeAgo('2026-10-31T11:59:30.000Z', now)).toBe('just now');
    expect(timeAgo('2026-10-31T11:55:00.000Z', now)).toBe('5 min ago');
    expect(timeAgo('2026-10-31T09:00:00.000Z', now)).toBe('3 h ago');
    expect(timeAgo('2026-10-29T12:00:00.000Z', now)).toBe('2 days ago');
    expect(timeAgo('2026-10-30T11:00:00.000Z', now)).toBe('1 day ago');
  });
});
