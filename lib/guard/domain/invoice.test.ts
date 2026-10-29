import { describe, expect, it } from 'vitest';
import {
  evaluateInvoiceCreation,
  evaluateInvoiceSending,
  parseInvoiceDraft,
  parseInvoiceSending,
  type InvoiceFacts,
  type InvoiceLimits,
} from './invoice';
import type { Money } from './policy';

const usd = (minor: number): Money => ({ minor, currency: 'USD' });
const mandate = { customerEmail: 'ana@example.com' };
const limits: InvoiceLimits = { approvalThreshold: usd(10000), perInvoice: usd(50000), daily: usd(100000) };

// create_invoice's flat arguments, as the toolkit takes them.
const args = (overrides: Record<string, unknown> = {}) => ({
  currency_code: 'USD',
  primary_recipients: [{ billing_info: { email_address: 'ana@example.com', name: { given_name: 'Ana' } } }],
  items: [{ name: 'Mug', quantity: '2', unit_amount: { currency_code: 'USD', value: '12.50' } }],
  ...overrides,
});
const item = (quantity: string, value: string, currency_code = 'USD') => ({ name: 'Item', quantity, unit_amount: { currency_code, value } });

describe('parseInvoiceDraft', () => {
  it('reads the one recipient and the total in minor units', () => {
    expect(parseInvoiceDraft(args())).toEqual({ draft: { recipientEmail: 'ana@example.com', total: usd(2500) } });
  });

  it('adds every line and the shipping cost without float drift', () => {
    const items = [item('3', '0.10'), item('1', '0.20')];
    expect(parseInvoiceDraft(args({ items, shipping_cost: '4.99' }))).toEqual({ draft: { recipientEmail: 'ana@example.com', total: usd(549) } });
  });

  it('rounds a fractional quantity up to the next minor unit, so the guard never counts less than is billed', () => {
    expect(parseInvoiceDraft(args({ items: [item('1.5', '0.01')] }))).toEqual({ draft: { recipientEmail: 'ana@example.com', total: usd(2) } });
    expect(parseInvoiceDraft(args({ items: [item('0.333', '3.00')] }))).toEqual({ draft: { recipientEmail: 'ana@example.com', total: usd(100) } });
  });

  it('refuses a taxed item, which would bill more than the total the guard checks', () => {
    const taxed = { ...item('1', '10.00'), tax: { name: 'VAT', percent: '100' } };
    expect(parseInvoiceDraft(args({ items: [taxed] }))).toEqual({ invalid: "items[0] can't carry tax: the guard checks the invoice total without it" });
  });

  it('refuses anything but exactly one recipient with an email', () => {
    for (const primary_recipients of [[], undefined, [{ billing_info: {} }], [{}], [{ billing_info: { email_address: '' } }], [args().primary_recipients[0], args().primary_recipients[0]]]) {
      expect(parseInvoiceDraft(args({ primary_recipients }))).toEqual({ invalid: expect.stringContaining('exactly one primary recipient') });
    }
  });

  it('refuses no items, a quantity that is not positive, or a unit amount that is not a plain non-negative amount', () => {
    for (const items of [[], undefined, [item('0', '1.00')], [item('-1', '1.00')], [item('abc', '1.00')], [item('1', '-1.00')], [item('1', '1.001')], [item('1', '1e3')], [{ name: 'x', quantity: '1' }]]) {
      expect(parseInvoiceDraft(args({ items }))).toMatchObject({ invalid: expect.any(String) });
    }
  });

  it('refuses an item in another currency than the invoice, or an unreadable currency', () => {
    expect(parseInvoiceDraft(args({ items: [item('1', '1.00', 'EUR')] }))).toEqual({ invalid: expect.stringContaining('currency') });
    expect(parseInvoiceDraft(args({ currency_code: 'usd', items: [item('1', '1.00', 'usd')] }))).toEqual({ invalid: expect.stringContaining('currency') });
  });

  it('refuses a negative or unreadable shipping cost', () => {
    for (const shipping_cost of ['-5', '1.234', 'free', 5]) {
      expect(parseInvoiceDraft(args({ shipping_cost }))).toEqual({ invalid: expect.stringContaining('shipping_cost') });
    }
  });

  it('refuses an invoice that bills nothing', () => {
    expect(parseInvoiceDraft(args({ items: [item('1', '0.00')] }))).toEqual({ invalid: expect.stringContaining('bills nothing') });
  });
});

describe('evaluateInvoiceCreation', () => {
  const draft = { recipientEmail: 'ana@example.com', total: usd(2500) };
  const context = { draft, mandate, known: true, limits, billedToday: usd(0) };

  it('allows a small invoice to the task customer, an existing customer, within the limits', () => {
    expect(evaluateInvoiceCreation(context)).toEqual({ verdict: 'allow', violations: [] });
  });

  it('blocks billing someone other than the task customer', () => {
    expect(evaluateInvoiceCreation({ ...context, draft: { ...draft, recipientEmail: 'mallory@example.com' } })).toEqual({
      verdict: 'block',
      violations: [{ code: 'CUSTOMER_MISMATCH', message: 'Invoice recipient is not the task customer ana@example.com' }],
    });
  });

  it('blocks billing someone who is not one of the shop customers', () => {
    expect(evaluateInvoiceCreation({ ...context, known: false })).toEqual({
      verdict: 'block',
      violations: [{ code: 'UNKNOWN_CUSTOMER', message: 'ana@example.com is not an existing customer of the shop' }],
    });
  });

  it('blocks an invoice over the per-invoice limit, without asking for approval', () => {
    expect(evaluateInvoiceCreation({ ...context, draft: { ...draft, total: usd(50001) } })).toEqual({
      verdict: 'block',
      violations: [{ code: 'INVOICE_LIMIT', message: 'Invoice 500.01 USD is over the per-invoice limit 500.00 USD' }],
    });
  });

  it('blocks an invoice that would take today past the daily cap, or in another currency than the cap', () => {
    expect(evaluateInvoiceCreation({ ...context, billedToday: usd(98000) })).toEqual({
      verdict: 'block',
      violations: [{ code: 'DAILY_LIMIT', message: 'Invoices today would reach 1005.00 USD, over 1000.00 USD' }],
    });
    expect(evaluateInvoiceCreation({ ...context, draft: { ...draft, total: { minor: 2500, currency: 'EUR' } }, billedToday: { minor: 0, currency: 'EUR' } }).violations.map((v) => v.code)).toEqual([
      'INVOICE_LIMIT',
      'DAILY_LIMIT',
    ]);
  });

  it('holds a clean invoice over the approval threshold, and allows one exactly at it', () => {
    expect(evaluateInvoiceCreation({ ...context, draft: { ...draft, total: usd(10001) } })).toEqual({
      verdict: 'hold',
      violations: [{ code: 'APPROVAL_REQUIRED', message: 'Invoice 100.01 USD is over the approval threshold 100.00 USD' }],
    });
    expect(evaluateInvoiceCreation({ ...context, draft: { ...draft, total: usd(10000) } }).verdict).toBe('allow');
  });

  it('never asks for approval of an invoice it blocks', () => {
    const decision = evaluateInvoiceCreation({ ...context, known: false, draft: { ...draft, total: usd(20000) } });
    expect(decision.verdict).toBe('block');
    expect(decision.violations.map((v) => v.code)).toEqual(['UNKNOWN_CUSTOMER']);
  });
});

describe('parseInvoiceSending', () => {
  it('reads a plain invoice id, sending only to the invoice recipient', () => {
    expect(parseInvoiceSending('send_invoice', { invoice_id: 'INV2-ABC1', note: 'Thanks' })).toEqual({ invoiceId: 'INV2-ABC1' });
    expect(parseInvoiceSending('send_invoice', { invoice_id: 'INV2-ABC1', send_to_recipient: true, additional_recipients: [] })).toEqual({ invoiceId: 'INV2-ABC1' });
    expect(parseInvoiceSending('send_invoice_reminder', { invoice_id: 'INV2-ABC1', subject: 'Reminder' })).toEqual({ invoiceId: 'INV2-ABC1' });
  });

  it('refuses an id that is not plain', () => {
    for (const invoice_id of ['../x', 'INV2 1', '', undefined, 'A'.repeat(128)]) {
      expect(parseInvoiceSending('send_invoice', { invoice_id })).toEqual({ invalid: 'send_invoice needs a plain invoice_id' });
    }
  });

  it('refuses sending to anyone but the invoice recipient', () => {
    expect(parseInvoiceSending('send_invoice_reminder', { invoice_id: 'INV2-1', additional_recipients: ['mallory@example.com'] })).toEqual({
      invalid: "send_invoice_reminder may send only to the invoice's own recipient: additional_recipients must be empty",
    });
    expect(parseInvoiceSending('send_invoice', { invoice_id: 'INV2-1', additional_recipients: 'mallory@example.com' })).toMatchObject({ invalid: expect.stringContaining('additional_recipients') });
    expect(parseInvoiceSending('send_invoice', { invoice_id: 'INV2-1', send_to_recipient: false })).toEqual({
      invalid: "send_invoice may send only to the invoice's own recipient: send_to_recipient cannot be false",
    });
  });
});

describe('evaluateInvoiceSending', () => {
  const invoice: InvoiceFacts = { id: 'INV2-1', status: 'DRAFT', amount: usd(2500), recipientEmails: ['ana@example.com'] };

  it('allows sending a draft invoice of the task customer', () => {
    expect(evaluateInvoiceSending({ invoice, mandate, reminder: false, remindersThisTask: 0 })).toEqual({ verdict: 'allow', violations: [] });
  });

  it('blocks an invoice of another customer, of several recipients, or of none', () => {
    for (const recipientEmails of [['ben@example.com'], ['ana@example.com', 'ben@example.com'], []]) {
      expect(evaluateInvoiceSending({ invoice: { ...invoice, recipientEmails }, mandate, reminder: false, remindersThisTask: 0 })).toEqual({
        verdict: 'block',
        violations: [{ code: 'CUSTOMER_MISMATCH', message: 'Invoice INV2-1 is not billed to the task customer ana@example.com alone' }],
      });
    }
  });

  it('sends only a draft, and reminds only of a sent, unpaid or partially paid invoice', () => {
    expect(evaluateInvoiceSending({ invoice: { ...invoice, status: 'SENT' }, mandate, reminder: false, remindersThisTask: 0 })).toEqual({
      verdict: 'block',
      violations: [{ code: 'INVOICE_NOT_SENDABLE', message: 'Invoice status is SENT; only a DRAFT invoice can be sent' }],
    });
    for (const status of ['SENT', 'UNPAID', 'PARTIALLY_PAID']) {
      expect(evaluateInvoiceSending({ invoice: { ...invoice, status }, mandate, reminder: true, remindersThisTask: 0 }).verdict).toBe('allow');
    }
    for (const status of ['DRAFT', 'PAID', 'CANCELLED', 'MARKED_AS_PAID', '']) {
      expect(evaluateInvoiceSending({ invoice: { ...invoice, status }, mandate, reminder: true, remindersThisTask: 0 }).violations.map((v) => v.code)).toEqual(['INVOICE_NOT_SENDABLE']);
    }
  });

  it('allows one reminder per invoice per task', () => {
    expect(evaluateInvoiceSending({ invoice: { ...invoice, status: 'UNPAID' }, mandate, reminder: true, remindersThisTask: 1 })).toEqual({
      verdict: 'block',
      violations: [{ code: 'REMINDER_LIMIT', message: 'A task may send at most 1 reminder for invoice INV2-1' }],
    });
    // Sending is not a reminder: the count doesn't apply.
    expect(evaluateInvoiceSending({ invoice, mandate, reminder: false, remindersThisTask: 1 }).verdict).toBe('allow');
  });
});
