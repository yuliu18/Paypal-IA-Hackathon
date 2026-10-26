import { describe, expect, it } from 'vitest';
import { createPayPalInvoiceLookup, toInvoiceFacts } from './paypal-invoice-lookup';

// Shaped like PayPal's GET /v2/invoicing/invoices/{id} answer.
const invoice = {
  id: 'INV2-ABCD-1234',
  status: 'SENT',
  detail: { invoice_number: '0042', currency_code: 'USD' },
  invoicer: { email_address: 'shop@business.example.com' },
  primary_recipients: [{ billing_info: { email_address: 'ana@example.com', name: { given_name: 'Ana' } } }],
  amount: { currency_code: 'USD', value: '25.00', breakdown: {} },
};
const facts = { id: 'INV2-ABCD-1234', status: 'SENT', amount: { minor: 2500, currency: 'USD' }, recipientEmails: ['ana@example.com'] };

function fakeFetch(respond: (url: string, init: RequestInit) => Response | Promise<Response>) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fetch = async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    return respond(String(url), init ?? {});
  };
  return { fetch: fetch as typeof globalThis.fetch, calls };
}

const lookup = (fetch: typeof globalThis.fetch, timeoutMs = 50) => createPayPalInvoiceLookup({ fetch, token: async () => 'TOKEN', timeoutMs });

describe('toInvoiceFacts', () => {
  it('maps the id, the status, the total and every recipient email', () => {
    expect(toInvoiceFacts(invoice)).toEqual(facts);
    const two = [...invoice.primary_recipients, { billing_info: { email_address: 'ben@example.com' } }];
    expect(toInvoiceFacts({ ...invoice, primary_recipients: two }).recipientEmails).toEqual(['ana@example.com', 'ben@example.com']);
  });

  it('keeps a recipient without an email as an empty one, so it never counts as the customer', () => {
    expect(toInvoiceFacts({ ...invoice, primary_recipients: [{ billing_info: {} }] }).recipientEmails).toEqual(['']);
    expect(toInvoiceFacts({ ...invoice, primary_recipients: undefined }).recipientEmails).toEqual([]);
  });

  it('has no total when PayPal gives none that can be read', () => {
    expect(toInvoiceFacts({ ...invoice, amount: undefined }).amount).toBeNull();
    expect(toInvoiceFacts({ ...invoice, amount: { currency_code: 'USD', value: '-1' } }).amount).toBeNull();
  });

  it('refuses an answer without an id or a status', () => {
    expect(() => toInvoiceFacts({ status: 'SENT' })).toThrow('Unreadable PayPal invoice');
    expect(() => toInvoiceFacts({ id: 'INV2-1' })).toThrow('Unreadable PayPal invoice');
    expect(() => toInvoiceFacts('nope')).toThrow('Unreadable PayPal invoice');
  });
});

describe('payPal invoice lookup', () => {
  it('reads the invoice from PayPal with the access token', async () => {
    const { fetch, calls } = fakeFetch(() => Response.json(invoice));
    expect(await lookup(fetch).getInvoice('INV2-ABCD-1234')).toEqual(facts);
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe('https://api-m.sandbox.paypal.com/v2/invoicing/invoices/INV2-ABCD-1234');
    expect(calls[0].init.headers).toEqual({ Authorization: 'Bearer TOKEN' });
  });

  it('keeps the id inside the invoice path', async () => {
    const { fetch, calls } = fakeFetch(() => Response.json(invoice));
    await lookup(fetch).getInvoice('../../v2/checkout/orders/X');
    expect(calls[0].url).toBe('https://api-m.sandbox.paypal.com/v2/invoicing/invoices/..%2F..%2Fv2%2Fcheckout%2Forders%2FX');
  });

  it('answers undefined for an invoice PayPal does not know', async () => {
    const { fetch } = fakeFetch(() => new Response('{"name":"RESOURCE_NOT_FOUND"}', { status: 404 }));
    expect(await lookup(fetch).getInvoice('INV2-NOPE')).toBeUndefined();
  });

  it('fails on any other PayPal error, or an answer it cannot read', async () => {
    await expect(lookup(fakeFetch(() => new Response('boom', { status: 500 })).fetch).getInvoice('INV2-1')).rejects.toThrow('PayPal 500');
    await expect(lookup(fakeFetch(() => Response.json({ status: 'SENT' })).fetch).getInvoice('INV2-1')).rejects.toThrow('Unreadable PayPal invoice');
  });

  it('gives up on a PayPal answer that never comes', async () => {
    const { fetch } = fakeFetch(
      (_url, init) =>
        new Promise((_, reject) => {
          init.signal?.addEventListener('abort', () => reject(init.signal?.reason));
        }),
    );
    await expect(lookup(fetch, 20).getInvoice('INV2-1')).rejects.toThrow();
  });
});
