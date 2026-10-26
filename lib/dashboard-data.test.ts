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

  it('names the event types the sandbox ledger holds, and keeps the code of any other', () => {
    const rows = transactionRows([
      tx('sale', 'T0006', '40.00'),
      tx('card', 'T0005', '35.50'),
      tx('fx', 'T0200', '5.24'),
      tx('refund', 'T1107', '-10.00'),
      tx('dispute', 'T1106', '-70.00'),
      tx('subscription', 'T0002', '9.99'),
      tx('hold', 'T1110', '-20.00'),
      tx('release', 'T1111', '20.00'),
      tx('correction', 'T1900', '3.00'),
      tx('odd', 'T9999', '1.00'),
    ]);
    expect(rows.map((r) => r.eventType)).toEqual([
      'Checkout payment',
      'Card payment',
      'Currency conversion',
      'Refund',
      'Payment reversal',
      'Subscription payment',
      'Dispute hold',
      'Dispute hold released',
      'Account correction',
      'T9999',
    ]);
  });

  it('splits each amount into money in and money out, both positive, so a chart can show them side by side', () => {
    const rows = transactionRows([tx('in', 'T0006', '40.00'), tx('out', 'T1107', '-10.50')]);
    expect(rows.map((r) => [r.moneyIn, r.moneyOut])).toEqual([
      [40, 0],
      [0, 10.5],
    ]);
  });
});
