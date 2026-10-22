import { describe, expect, it } from 'vitest';
import { minimizeOrder } from './privacy';

// Shaped like a live sandbox get_order answer.
const paypalOrder = {
  id: '63Y52401YN1199353',
  intent: 'CAPTURE',
  status: 'COMPLETED',
  create_time: '2026-10-21T21:30:00Z',
  payment_source: { card: { name: 'Sandbox Buyer', last_digits: '1111', expiry: '2030-12', brand: 'VISA', type: 'UNKNOWN', bin_details: {} } },
  payer: { email_address: 'ana@example.com', name: { given_name: 'Ana', surname: 'Lopez' }, address: { country_code: 'ES' } },
  purchase_units: [
    {
      reference_id: 'default',
      amount: { currency_code: 'USD', value: '49.99', breakdown: {} },
      payee: { email_address: 'shop@business.example.com', merchant_id: 'ZR6AR9JXYUB68' },
      description: 'Ceramic mug set',
      custom_id: 'ana@example.com',
      soft_descriptor: 'TEST STORE',
      shipping: { name: { full_name: 'Ana Lopez' }, address: { address_line_1: 'Calle Mayor 1', admin_area_2: 'Madrid' } },
      supplementary_data: { risk: { risk_level_indicator: 'HIGH_RISK' } },
      payments: {
        captures: [
          {
            id: 'CAP-1',
            status: 'COMPLETED',
            amount: { currency_code: 'USD', value: '49.99' },
            final_capture: true,
            create_time: '2026-10-21T21:30:01Z',
            seller_receivable_breakdown: { gross_amount: { currency_code: 'USD', value: '49.99' } },
            links: [{ href: 'https://api.sandbox.paypal.com/v2/payments/captures/CAP-1', rel: 'self' }],
          },
        ],
        refunds: [{ id: 'REF-1', status: 'COMPLETED', amount: { currency_code: 'USD', value: '10.00' }, create_time: '2026-10-21T22:00:00Z', note_to_payer: 'Sorry Ana' }],
      },
    },
  ],
  links: [{ href: 'https://api.sandbox.paypal.com/v2/checkout/orders/63Y52401YN1199353', rel: 'self' }],
};

describe('minimizeOrder', () => {
  it('keeps only what a refund needs: ids, status, amounts, dates and the item description', () => {
    expect(minimizeOrder(paypalOrder).order).toEqual({
      id: '63Y52401YN1199353',
      intent: 'CAPTURE',
      status: 'COMPLETED',
      create_time: '2026-10-21T21:30:00Z',
      purchase_units: [
        {
          reference_id: 'default',
          amount: { currency_code: 'USD', value: '49.99' },
          description: 'Ceramic mug set',
          payments: {
            captures: [{ id: 'CAP-1', status: 'COMPLETED', amount: { currency_code: 'USD', value: '49.99' }, final_capture: true, create_time: '2026-10-21T21:30:01Z' }],
            refunds: [{ id: 'REF-1', status: 'COMPLETED', amount: { currency_code: 'USD', value: '10.00' }, create_time: '2026-10-21T22:00:00Z' }],
          },
        },
      ],
    });
  });

  it('lists every field it withheld, so the agent and the demo can see what was hidden', () => {
    expect(minimizeOrder(paypalOrder).withheld).toEqual([
      'payment_source',
      'payer',
      'purchase_units[0].amount.breakdown',
      'purchase_units[0].payee',
      'purchase_units[0].custom_id',
      'purchase_units[0].soft_descriptor',
      'purchase_units[0].shipping',
      'purchase_units[0].supplementary_data',
      'purchase_units[0].payments.captures[0].seller_receivable_breakdown',
      'purchase_units[0].payments.captures[0].links',
      'purchase_units[0].payments.refunds[0].note_to_payer',
      'links',
    ]);
  });

  it('never lets card, email, name or address text through, wherever PayPal puts it', () => {
    const text = JSON.stringify(minimizeOrder(paypalOrder).order);
    for (const secret of ['1111', '2030-12', 'Sandbox Buyer', '@', 'Ana Lopez', 'Calle Mayor', 'ZR6AR9JXYUB68']) expect(text).not.toContain(secret);
  });

  it('withholds keys that only exist on JavaScript objects instead of failing', () => {
    const odd = JSON.parse('{"id":"O-1","constructor":{"name":{"x":1}},"toString":{"length":{"x":1}}}');
    expect(minimizeOrder(odd)).toEqual({ order: { id: 'O-1' }, withheld: ['constructor', 'toString'] });
  });

  it('drops a kept field whose value has the wrong shape instead of passing it through', () => {
    const odd = { id: 'O-1', status: { email: 'ana@example.com' }, purchase_units: 'ana@example.com' };
    expect(minimizeOrder(odd)).toEqual({ order: { id: 'O-1' }, withheld: ['status', 'purchase_units'] });
  });
});
