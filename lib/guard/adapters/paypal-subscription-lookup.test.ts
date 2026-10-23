import { describe, expect, it } from 'vitest';
import { createPayPalSubscriptionLookup, toSubscriptionFacts } from './paypal-subscription-lookup';

const subscription = {
  id: 'I-SUB1',
  status: 'ACTIVE',
  plan_id: 'P-1',
  custom_id: 'mallory@example.com',
  subscriber: { email_address: 'ana@example.com', name: { given_name: 'Ana' } },
};

function fakeFetch(respond: (url: string, init: RequestInit) => Response | Promise<Response>) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fetch = async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    return respond(String(url), init ?? {});
  };
  return { fetch: fetch as typeof globalThis.fetch, calls };
}

const lookup = (fetch: typeof globalThis.fetch, timeoutMs = 50) => createPayPalSubscriptionLookup({ fetch, token: async () => 'TOKEN', timeoutMs });

describe('toSubscriptionFacts', () => {
  it('maps the id, the status and the subscriber the subscription belongs to', () => {
    expect(toSubscriptionFacts(subscription)).toEqual({ id: 'I-SUB1', status: 'ACTIVE', customerEmail: 'ana@example.com' });
  });

  it('reports a subscription without a subscriber email as an unknown owner, never custom_id', () => {
    expect(toSubscriptionFacts({ ...subscription, subscriber: {} })).toEqual({ id: 'I-SUB1', status: 'ACTIVE', customerEmail: null });
    expect(toSubscriptionFacts({ ...subscription, subscriber: { email_address: 42 } }).customerEmail).toBeNull();
  });

  it('refuses an answer without an id or status', () => {
    expect(() => toSubscriptionFacts({ status: 'ACTIVE' })).toThrow('Unreadable PayPal subscription');
    expect(() => toSubscriptionFacts('nope')).toThrow('Unreadable PayPal subscription');
  });
});

describe('payPal subscription lookup', () => {
  it('reads the subscription from PayPal with the access token', async () => {
    const { fetch, calls } = fakeFetch(() => Response.json(subscription));
    expect(await lookup(fetch).getSubscription('I-SUB1')).toEqual({ id: 'I-SUB1', status: 'ACTIVE', customerEmail: 'ana@example.com' });
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe('https://api-m.sandbox.paypal.com/v1/billing/subscriptions/I-SUB1');
    expect(calls[0].init.headers).toEqual({ Authorization: 'Bearer TOKEN' });
  });

  it('keeps the id inside the subscription path', async () => {
    const { fetch, calls } = fakeFetch(() => Response.json(subscription));
    await lookup(fetch).getSubscription('../../v2/checkout/orders/X');
    expect(calls[0].url).toBe('https://api-m.sandbox.paypal.com/v1/billing/subscriptions/..%2F..%2Fv2%2Fcheckout%2Forders%2FX');
  });

  it('answers undefined for a subscription PayPal does not know', async () => {
    const { fetch } = fakeFetch(() => new Response('{"name":"RESOURCE_NOT_FOUND"}', { status: 404 }));
    expect(await lookup(fetch).getSubscription('I-NOPE')).toBeUndefined();
  });

  it('fails on any other PayPal error', async () => {
    const { fetch } = fakeFetch(() => new Response('boom', { status: 500 }));
    await expect(lookup(fetch).getSubscription('I-SUB1')).rejects.toThrow('PayPal 500');
  });

  it('gives up on a PayPal answer that never comes', async () => {
    const { fetch } = fakeFetch(
      (_url, init) =>
        new Promise((_, reject) => {
          init.signal?.addEventListener('abort', () => reject(init.signal?.reason));
        }),
    );
    await expect(lookup(fetch, 20).getSubscription('I-SUB1')).rejects.toThrow();
  });
});
