import { describe, expect, it } from 'vitest';
import { minimizeInvoice, minimizeOrder, minimizeSubscription } from './privacy';

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

  it('masks emails and card numbers the shop wrote into the item description', () => {
    const order = { id: 'O-1', purchase_units: [{ description: 'Gift for ben@example.com, paid 4111111111111111' }] };
    expect(minimizeOrder(order).order).toEqual({ id: 'O-1', purchase_units: [{ description: 'Gift for b***@example.com, paid [card •••• 1111]' }] });
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

// Shaped like a live sandbox GET /v1/billing/subscriptions/{id} answer, with ?fields=plan.
const paypalSubscription = {
  id: 'I-BW452GLLEP1G',
  plan_id: 'P-5ML4271244454362WXNWU5NQ',
  status: 'ACTIVE',
  status_update_time: '2026-10-21T21:30:00Z',
  start_time: '2026-10-21T21:00:00Z',
  create_time: '2026-10-21T20:59:00Z',
  update_time: '2026-10-21T21:30:00Z',
  quantity: '1',
  custom_id: 'ana@example.com',
  plan_overridden: false,
  shipping_amount: { currency_code: 'USD', value: '0.0' },
  subscriber: {
    email_address: 'ana@example.com',
    payer_id: 'QYR5Z8XDVJNXQ',
    name: { given_name: 'Ana', surname: 'Lopez' },
    shipping_address: { address: { address_line_1: 'Calle Mayor 1', admin_area_2: 'Madrid' } },
  },
  billing_info: {
    outstanding_balance: { currency_code: 'USD', value: '0.0' },
    cycle_executions: [{ tenure_type: 'REGULAR', sequence: 1, cycles_completed: 1 }],
    last_payment: { amount: { currency_code: 'USD', value: '9.99' }, time: '2026-10-21T21:30:00Z' },
    next_billing_time: '2026-11-21T10:00:00Z',
    failed_payments_count: 0,
  },
  plan: { name: 'Coffee club', billing_cycles: [] },
  links: [{ href: 'https://api.sandbox.paypal.com/v1/billing/subscriptions/I-BW452GLLEP1G', rel: 'self' }],
};

describe('minimizeSubscription', () => {
  it('keeps only what a cancellation needs: ids, status, dates, next billing time and last payment', () => {
    expect(minimizeSubscription(paypalSubscription).subscription).toEqual({
      id: 'I-BW452GLLEP1G',
      plan_id: 'P-5ML4271244454362WXNWU5NQ',
      status: 'ACTIVE',
      start_time: '2026-10-21T21:00:00Z',
      create_time: '2026-10-21T20:59:00Z',
      update_time: '2026-10-21T21:30:00Z',
      billing_info: {
        last_payment: { amount: { currency_code: 'USD', value: '9.99' }, time: '2026-10-21T21:30:00Z' },
        next_billing_time: '2026-11-21T10:00:00Z',
      },
    });
  });

  it('lists every field it withheld, subscriber, custom_id and links included', () => {
    expect(minimizeSubscription(paypalSubscription).withheld).toEqual([
      'status_update_time',
      'quantity',
      'custom_id',
      'plan_overridden',
      'shipping_amount',
      'subscriber',
      'billing_info.outstanding_balance',
      'billing_info.cycle_executions',
      'billing_info.failed_payments_count',
      'plan',
      'links',
    ]);
  });

  it('never lets the subscriber email, name or address through', () => {
    const text = JSON.stringify(minimizeSubscription(paypalSubscription).subscription);
    for (const secret of ['@', 'Ana', 'Lopez', 'Calle Mayor', 'QYR5Z8XDVJNXQ']) expect(text).not.toContain(secret);
  });

  it('drops a kept field whose value has the wrong shape instead of passing it through', () => {
    const odd = { id: 'I-1', status: { email: 'ana@example.com' }, billing_info: 'ana@example.com' };
    expect(minimizeSubscription(odd)).toEqual({ subscription: { id: 'I-1' }, withheld: ['status', 'billing_info'] });
  });
});

// Shaped like PayPal's get_invoice answer.
const paypalInvoice = {
  id: 'INV2-ABCD-1234',
  status: 'SENT',
  detail: {
    invoice_number: '0042',
    reference: 'PO-9',
    currency_code: 'USD',
    note: 'Thanks, write to ana@example.com',
    invoice_date: '2026-10-26',
    payment_term: { term_type: 'NET_10', due_date: '2026-11-05' },
    metadata: { create_time: '2026-10-26T10:00:00Z', recipient_view_url: 'https://www.sandbox.paypal.com/invoice/p/#X' },
  },
  invoicer: { email_address: 'shop@business.example.com', name: { given_name: 'Shop' } },
  primary_recipients: [{ billing_info: { email_address: 'ana@example.com', name: { given_name: 'Ana', surname: 'Lopez' } }, shipping_info: { address: { address_line_1: 'Calle Mayor 1' } } }],
  items: [{ id: 'ITEM-1', name: 'Ceramic mug set', description: 'Blue', quantity: '2', unit_amount: { currency_code: 'USD', value: '12.50' }, tax: { name: 'VAT', percent: '0' } }],
  amount: { currency_code: 'USD', value: '25.00', breakdown: { item_total: { currency_code: 'USD', value: '25.00' } } },
  due_amount: { currency_code: 'USD', value: '15.00' },
  payments: { paid_amount: { currency_code: 'USD', value: '10.00' }, transactions: [{ payment_id: 'PAY-1', amount: { currency_code: 'USD', value: '10.00' }, payment_date: '2026-10-27', note: 'by ana@example.com' }] },
  refunds: { refund_amount: { currency_code: 'USD', value: '0.00' }, transactions: [] },
  links: [{ href: 'https://api.sandbox.paypal.com/v2/invoicing/invoices/INV2-ABCD-1234', rel: 'self' }],
};

describe('minimizeInvoice', () => {
  it('keeps only what billing needs: id, status, number, dates, items, amounts, payments and refunds', () => {
    expect(minimizeInvoice(paypalInvoice).invoice).toEqual({
      id: 'INV2-ABCD-1234',
      status: 'SENT',
      detail: { invoice_number: '0042', currency_code: 'USD', note: 'Thanks, write to a***@example.com', invoice_date: '2026-10-26', payment_term: { due_date: '2026-11-05' } },
      items: [{ name: 'Ceramic mug set', quantity: '2', unit_amount: { currency_code: 'USD', value: '12.50' } }],
      amount: { currency_code: 'USD', value: '25.00' },
      due_amount: { currency_code: 'USD', value: '15.00' },
      payments: { paid_amount: { currency_code: 'USD', value: '10.00' }, transactions: [{ amount: { currency_code: 'USD', value: '10.00' }, payment_date: '2026-10-27' }] },
      refunds: { refund_amount: { currency_code: 'USD', value: '0.00' }, transactions: [] },
    });
  });

  it('lists every field it withheld, the invoicer, the recipients and links included', () => {
    expect(minimizeInvoice(paypalInvoice).withheld).toEqual([
      'detail.reference',
      'detail.payment_term.term_type',
      'detail.metadata',
      'invoicer',
      'primary_recipients',
      'items[0].id',
      'items[0].description',
      'items[0].tax',
      'amount.breakdown',
      'payments.transactions[0].payment_id',
      'payments.transactions[0].note',
      'links',
    ]);
  });

  it('never lets the recipient or invoicer email, name or address through', () => {
    const text = JSON.stringify(minimizeInvoice(paypalInvoice).invoice);
    for (const secret of ['ana@example.com', 'shop@business', 'Lopez', 'Calle Mayor', 'recipient_view_url']) expect(text).not.toContain(secret);
  });
});
