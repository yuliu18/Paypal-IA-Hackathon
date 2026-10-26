import { describe, expect, it } from 'vitest';
import { transactionRows } from './dashboard-data';
import type { Transaction } from './paypal';

const tx = (id: string, code: string, value: string): Transaction => ({
  transaction_info: {
    transaction_id: id,
    transaction_event_code: code,
    transaction_initiation_date: '2026-10-21T10:00:00Z',
    transaction_amount: { currency_code: 'USD', value },
  },
});

describe('transactionRows', () => {
  it('counts only money received for a payment as sales: not payouts, refunds or released holds', () => {
    const rows = transactionRows([
      tx('sale', 'T0006', '40.00'),
      tx('payout', 'T0001', '-25.00'),
      tx('refund', 'T1107', '-10.00'),
      tx('released', 'T1105', '15.00'),
    ]);
    expect(rows.map((r) => [r.id, r.sales])).toEqual([
      ['sale', 40],
      ['payout', 0],
      ['refund', 0],
      ['released', 0],
    ]);
  });
});
