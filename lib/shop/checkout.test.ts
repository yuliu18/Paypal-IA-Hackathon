import { describe, expect, it } from 'vitest';
import { checkoutUrls, completeSalesOrder, shopOrigin } from './checkout';

type Sent = { method: string; path: string; body?: unknown };

// A fake PayPal: answers by method and path, and records every request.
function fakePayPal(routes: Record<string, (body: unknown) => { status?: number; json?: unknown }>) {
  const sent: Sent[] = [];
  const fetch = (async (url: string, init: RequestInit = {}) => {
    const { pathname } = new URL(url);
    const method = init.method ?? 'GET';
    const body = typeof init.body === 'string' ? JSON.parse(init.body) : undefined;
    sent.push({ method, path: pathname, body });
    const route = routes[`${method} ${pathname}`];
    if (!route) return new Response('not found', { status: 404 });
    const { status = 200, json } = route(body);
    return Response.json(json, { status });
  }) as typeof globalThis.fetch;
  return { fetch, sent };
}

const token = async () => 'TOKEN';
const ORDER = '5O190127TN364715T';
const PATH = `/v2/checkout/orders/${ORDER}`;
const order = (status: string, customId?: string) => ({
  json: {
    id: ORDER,
    status,
    purchase_units: [{ reference_id: 'default', ...(customId && { custom_id: customId }), amount: { currency_code: 'USD', value: '99.98' } }],
  },
});
const captured = () => ({ status: 201, json: { status: 'COMPLETED', purchase_units: [{ payments: { captures: [{ id: 'CAP-9', status: 'COMPLETED' }] } }] } });

describe('shopOrigin', () => {
  it('is the origin the request came from, else APP_URL, else the local dev server, without path', () => {
    expect(shopOrigin('https://shop.example')).toBe('https://shop.example');
    expect(shopOrigin('https://shop.example/some/page')).toBe('https://shop.example');
    const previous = process.env.APP_URL;
    try {
      process.env.APP_URL = 'https://app.example/';
      expect(shopOrigin(null)).toBe('https://app.example');
      delete process.env.APP_URL;
      expect(shopOrigin()).toBe('http://localhost:3000');
    } finally {
      if (previous === undefined) delete process.env.APP_URL;
      else process.env.APP_URL = previous;
    }
  });
});

describe('checkoutUrls', () => {
  it('sends the buyer back to the shop’s return route after approving, and to /sales when cancelling', () => {
    expect(checkoutUrls('https://shop.example')).toEqual({
      returnUrl: 'https://shop.example/api/sales/paypal-return',
      cancelUrl: 'https://shop.example/sales?order=cancelled',
    });
  });
});

describe('completeSalesOrder', () => {
  it('captures an approved order the guard bound to a customer and says whose it is', async () => {
    const { fetch, sent } = fakePayPal({ [`GET ${PATH}`]: () => order('APPROVED', 'ana@example.com'), [`POST ${PATH}/capture`]: captured });

    expect(await completeSalesOrder(ORDER, { fetch, token })).toEqual({ orderId: ORDER, captureId: 'CAP-9', customerEmail: 'ana@example.com', amount: '99.98 USD' });
    expect(sent.map((s) => `${s.method} ${s.path}`)).toEqual([`GET ${PATH}`, `POST ${PATH}/capture`]);
  });

  it('captures nothing for an order no customer is bound to', async () => {
    const { fetch, sent } = fakePayPal({ [`GET ${PATH}`]: () => order('APPROVED'), [`POST ${PATH}/capture`]: captured });

    await expect(completeSalesOrder(ORDER, { fetch, token })).rejects.toThrow(/not bound to a customer/);
    expect(sent.map((s) => s.method)).toEqual(['GET']);
  });

  it('captures nothing for an order the buyer has not approved, or that was already paid', async () => {
    for (const status of ['CREATED', 'COMPLETED', 'VOIDED']) {
      const { fetch, sent } = fakePayPal({ [`GET ${PATH}`]: () => order(status, 'ana@example.com'), [`POST ${PATH}/capture`]: captured });
      await expect(completeSalesOrder(ORDER, { fetch, token })).rejects.toThrow(new RegExp(`is ${status}, not approved`));
      expect(sent.map((s) => s.method)).toEqual(['GET']);
    }
  });

  it('refuses an id that is not a plain PayPal order id without calling PayPal', async () => {
    const { fetch, sent } = fakePayPal({});
    for (const id of ['', '../v1/payments', `${ORDER}/capture`]) {
      await expect(completeSalesOrder(id, { fetch, token })).rejects.toThrow(/not a PayPal order id/);
    }
    expect(sent).toEqual([]);
  });
});
