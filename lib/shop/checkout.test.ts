import { describe, expect, it } from 'vitest';
import { checkoutEnvironment, checkoutUrls, completeSalesOrder, shopOrigin } from './checkout';

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
// The guard's audit log: the order it created and bound for ana.
const records = { boundOrderCustomer: async (id: string) => (id === ORDER ? 'ana@example.com' : undefined) };
const captured = () => ({ status: 201, json: { status: 'COMPLETED', purchase_units: [{ payments: { captures: [{ id: 'CAP-9', status: 'COMPLETED' }] } }] } });

describe('shopOrigin', () => {
  it('is APP_URL, else the local dev server, without path: never a value the caller sends', () => {
    const previous = process.env.APP_URL;
    try {
      process.env.APP_URL = 'https://app.example/some/page';
      expect(shopOrigin()).toBe('https://app.example');
      delete process.env.APP_URL;
      expect(shopOrigin()).toBe('http://localhost:3000');
    } finally {
      if (previous === undefined) delete process.env.APP_URL;
      else process.env.APP_URL = previous;
    }
  });
});

describe('checkoutUrls', () => {
  it('sends the buyer back to the shop’s return route after approving, and to the public /checkout page when cancelling', () => {
    expect(checkoutUrls('https://shop.example')).toEqual({
      returnUrl: 'https://shop.example/api/sales/paypal-return',
      cancelUrl: 'https://shop.example/checkout?order=cancelled',
    });
  });
});

describe('completeSalesOrder', () => {
  it('captures an approved order the guard bound to a customer and says whose it is', async () => {
    const { fetch, sent } = fakePayPal({ [`GET ${PATH}`]: () => order('APPROVED', 'ana@example.com'), [`POST ${PATH}/capture`]: captured });

    expect(await completeSalesOrder(ORDER, records, { fetch, token })).toEqual({ orderId: ORDER, captureId: 'CAP-9', customerEmail: 'ana@example.com', amount: '99.98 USD' });
    expect(sent.map((s) => `${s.method} ${s.path}`)).toEqual([`GET ${PATH}`, `POST ${PATH}/capture`]);
  });

  it('captures nothing for an order no customer is bound to', async () => {
    const { fetch, sent } = fakePayPal({ [`GET ${PATH}`]: () => order('APPROVED'), [`POST ${PATH}/capture`]: captured });

    await expect(completeSalesOrder(ORDER, records, { fetch, token })).rejects.toThrow(/not bound to a customer/);
    expect(sent.map((s) => s.method)).toEqual(['GET']);
  });

  it('captures nothing for an order the buyer has not approved, or that was already paid', async () => {
    for (const status of ['CREATED', 'COMPLETED', 'VOIDED']) {
      const { fetch, sent } = fakePayPal({ [`GET ${PATH}`]: () => order(status, 'ana@example.com'), [`POST ${PATH}/capture`]: captured });
      await expect(completeSalesOrder(ORDER, records, { fetch, token })).rejects.toThrow(new RegExp(`is ${status}, not approved`));
      expect(sent.map((s) => s.method)).toEqual(['GET']);
    }
  });

  it('captures nothing for an order the guard did not create and bind, or when its log cannot be read, without calling PayPal', async () => {
    const lookups = [{ boundOrderCustomer: async () => undefined }, { boundOrderCustomer: async () => Promise.reject(new Error('disk I/O error')) }];
    for (const audit of lookups) {
      const { fetch, sent } = fakePayPal({ [`GET ${PATH}`]: () => order('APPROVED', 'ana@example.com'), [`POST ${PATH}/capture`]: captured });
      await expect(completeSalesOrder(ORDER, audit, { fetch, token })).rejects.toThrow(/not an order the payment guard created for a customer|could not be checked/);
      expect(sent).toEqual([]);
    }
  });

  it('captures nothing when PayPal names another customer than the guard bound, in any purchase unit, or carries more than one', async () => {
    const unit = (customId: string) => ({ reference_id: customId, custom_id: customId, amount: { currency_code: 'USD', value: '99.98' } });
    const answers = [
      { id: ORDER, status: 'APPROVED', purchase_units: [unit('ben@example.com')] },
      { id: ORDER, status: 'APPROVED', purchase_units: [unit('ana@example.com'), unit('ben@example.com')] },
      { id: ORDER, status: 'APPROVED', purchase_units: [unit('ana@example.com'), unit('ana@example.com')] },
    ];
    for (const json of answers) {
      const { fetch, sent } = fakePayPal({ [`GET ${PATH}`]: () => ({ json }), [`POST ${PATH}/capture`]: captured });
      await expect(completeSalesOrder(ORDER, records, { fetch, token })).rejects.toThrow(/not bound to the customer the payment guard created it for/);
      expect(sent.map((s) => s.method)).toEqual(['GET']);
    }
  });

  it('refuses an id that is not a plain PayPal order id without calling PayPal', async () => {
    const { fetch, sent } = fakePayPal({});
    for (const id of ['', '../v1/payments', `${ORDER}/capture`]) {
      await expect(completeSalesOrder(id, records, { fetch, token })).rejects.toThrow(/not a PayPal order id/);
    }
    expect(sent).toEqual([]);
  });
});

describe('the PayPal environment of a checkout', () => {
  function recordingPayPal() {
    const hosts: string[] = [];
    const fetch = (async (url: string, init: RequestInit = {}) => {
      hosts.push(new URL(url).host);
      return (init.method ?? 'GET') === 'GET' ? Response.json(order('APPROVED', 'ana@example.com').json) : Response.json(captured().json, { status: 201 });
    }) as typeof globalThis.fetch;
    return { fetch, hosts };
  }
  // Bound for ana in one environment only.
  const boundIn = (environment: 'sandbox' | 'live') => {
    const asked: unknown[] = [];
    return {
      asked,
      records: {
        boundOrderCustomer: async (id: string, env?: 'sandbox' | 'live') => (asked.push(env), id === ORDER && env === environment ? 'ana@example.com' : undefined),
      },
    };
  };

  it('captures on the sandbox by default, checking the order was created there', async () => {
    const paypal = recordingPayPal();
    const { records, asked } = boundIn('sandbox');
    await completeSalesOrder(ORDER, records, { fetch: paypal.fetch, token });
    expect(asked).toEqual(['sandbox']);
    expect(paypal.hosts).toEqual(['api-m.sandbox.paypal.com', 'api-m.sandbox.paypal.com']);
  });

  it('captures a live order on live PayPal', async () => {
    const paypal = recordingPayPal();
    const { records, asked } = boundIn('live');
    await completeSalesOrder(ORDER, records, { fetch: paypal.fetch, token, environment: 'live' });
    expect(asked).toEqual(['live']);
    expect(paypal.hosts).toEqual(['api-m.paypal.com', 'api-m.paypal.com']);
  });

  it('captures nothing when the order was created in the other environment', async () => {
    const paypal = recordingPayPal();
    await expect(completeSalesOrder(ORDER, boundIn('sandbox').records, { fetch: paypal.fetch, token, environment: 'live' })).rejects.toThrow('not an order the payment guard created');
    await expect(completeSalesOrder(ORDER, boundIn('live').records, { fetch: paypal.fetch, token })).rejects.toThrow('not an order the payment guard created');
    expect(paypal.hosts).toEqual([]);
  });

  it('is live only for an order the guard created live, while live mode is on', async () => {
    expect(await checkoutEnvironment(ORDER, boundIn('live').records, { liveActive: true })).toBe('live');
    expect(await checkoutEnvironment(ORDER, boundIn('live').records, { liveActive: false })).toBe('sandbox');
    expect(await checkoutEnvironment(ORDER, boundIn('sandbox').records, { liveActive: true })).toBe('sandbox');
  });
});
