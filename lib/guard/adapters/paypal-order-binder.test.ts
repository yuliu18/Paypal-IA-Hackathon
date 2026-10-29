import { describe, expect, it } from 'vitest';
import { createPayPalOrderBinder } from './paypal-order-binder';

function fakeFetch(respond: (url: string, init: RequestInit) => Response | Promise<Response>) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fetch = async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    return respond(String(url), init ?? {});
  };
  return { fetch: fetch as typeof globalThis.fetch, calls };
}

const binder = (fetch: typeof globalThis.fetch, timeoutMs = 50) => createPayPalOrderBinder({ fetch, token: async () => 'TOKEN', timeoutMs });

describe('payPal order binder', () => {
  it("writes the customer into the order's custom_id, as the shop records whom it charges", async () => {
    const { fetch, calls } = fakeFetch(() => new Response(null, { status: 204 }));
    await binder(fetch).bindToCustomer('5O190127TN364715T', 'ana@example.com');
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe('https://api-m.sandbox.paypal.com/v2/checkout/orders/5O190127TN364715T');
    expect(calls[0].init.method).toBe('PATCH');
    expect(calls[0].init.headers).toEqual({ Authorization: 'Bearer TOKEN', 'Content-Type': 'application/json' });
    expect(JSON.parse(String(calls[0].init.body))).toEqual([
      { op: 'add', path: "/purchase_units/@reference_id=='default'/custom_id", value: 'ana@example.com' },
    ]);
  });

  it('refuses an order id that is not a plain PayPal id, without calling PayPal', async () => {
    const { fetch, calls } = fakeFetch(() => new Response(null, { status: 204 }));
    await expect(binder(fetch).bindToCustomer('../../v1/payments/X', 'ana@example.com')).rejects.toThrow('not a plain PayPal order id');
    expect(calls).toEqual([]);
  });

  it('fails on any PayPal error', async () => {
    const { fetch } = fakeFetch(() => new Response('{"name":"UNPROCESSABLE_ENTITY"}', { status: 422 }));
    await expect(binder(fetch).bindToCustomer('5O190127TN364715T', 'ana@example.com')).rejects.toThrow('PayPal 422 on /v2/checkout/orders/5O190127TN364715T');
  });

  it('gives up on a PayPal answer that never comes', async () => {
    const { fetch } = fakeFetch(
      (_url, init) =>
        new Promise((_, reject) => {
          init.signal?.addEventListener('abort', () => reject(init.signal?.reason));
        }),
    );
    await expect(binder(fetch, 20).bindToCustomer('5O190127TN364715T', 'ana@example.com')).rejects.toThrow();
  });
});
