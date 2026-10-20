import { describe, expect, it } from 'vitest';
import type { Capture, Order } from '@/lib/paypal';
import { toCaptureFacts, toMinor } from './paypal-capture-lookup';

const capture: Capture = {
  id: 'CAP-1',
  status: 'PARTIALLY_REFUNDED',
  amount: { value: '49.99', currency_code: 'USD' },
  supplementary_data: { related_ids: { order_id: 'ORD-1' } },
};

const order: Order = {
  id: 'ORD-1',
  status: 'COMPLETED',
  payer: { email_address: 'someone-else@example.com' },
  purchase_units: [
    {
      custom_id: 'ana@example.com',
      payments: {
        captures: [capture],
        refunds: [
          { id: 'R1', status: 'COMPLETED', amount: { value: '10.00', currency_code: 'USD' } },
          { id: 'R2', status: 'PENDING', amount: { value: '5.50', currency_code: 'USD' } },
          { id: 'R3', status: 'FAILED', amount: { value: '99.00', currency_code: 'USD' } },
          { id: 'R4', status: 'CANCELLED', amount: { value: '99.00', currency_code: 'USD' } },
        ],
      },
    },
  ],
};

describe('toMinor', () => {
  it('converts decimal strings to integer cents without float drift', () => {
    expect(toMinor({ value: '49.99', currency_code: 'USD' })).toEqual({ minor: 4999, currency: 'USD' });
    expect(toMinor({ value: '0.1', currency_code: 'EUR' })).toEqual({ minor: 10, currency: 'EUR' });
  });

  it('rejects amounts that are not plain decimals instead of producing NaN', () => {
    for (const value of ['', 'abc', '1e3', '1.2.3', ' 5']) {
      expect(() => toMinor({ value, currency_code: 'USD' })).toThrow('Invalid PayPal amount');
    }
  });
});

describe('toCaptureFacts', () => {
  it('maps the capture, the customer the shop recorded and the refunds that hold money', () => {
    expect(toCaptureFacts(capture, order)).toEqual({
      captureId: 'CAP-1',
      status: 'PARTIALLY_REFUNDED',
      captured: { minor: 4999, currency: 'USD' },
      refunded: { minor: 1550, currency: 'USD' },
      customerEmail: 'ana@example.com',
    });
  });

  it('reports a purchase unit without custom_id as an unknown customer so the policy blocks it', () => {
    const [unit] = order.purchase_units!;
    expect(toCaptureFacts(capture, { ...order, purchase_units: [{ ...unit, custom_id: undefined }] }).customerEmail).toBeNull();
  });

  it('takes the customer from the purchase unit that holds the capture', () => {
    const other = { custom_id: 'mallory@example.com', payments: { captures: [{ ...capture, id: 'CAP-9' }] } };
    expect(toCaptureFacts(capture, { ...order, purchase_units: [other, ...(order.purchase_units ?? [])] }).customerEmail).toBe('ana@example.com');
  });

  it('ignores refunds of other purchase units', () => {
    const other = { payments: { captures: [{ ...capture, id: 'CAP-9' }], refunds: [{ id: 'R9', status: 'COMPLETED', amount: { value: '1.00', currency_code: 'USD' } }] } };
    const facts = toCaptureFacts(capture, { ...order, purchase_units: [other, ...(order.purchase_units ?? [])] });
    expect(facts.refunded.minor).toBe(1550);
  });
});
