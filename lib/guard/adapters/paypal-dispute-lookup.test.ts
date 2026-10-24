import { describe, expect, it } from 'vitest';
import { createPayPalDisputeLookup, toDisputeFacts } from './paypal-dispute-lookup';

const dispute = {
  dispute_id: 'PP-D-1',
  status: 'WAITING_FOR_SELLER_RESPONSE',
  reason: 'MERCHANDISE_OR_SERVICE_NOT_RECEIVED',
  dispute_amount: { currency_code: 'USD', value: '20.00' },
  disputed_transactions: [{ seller_transaction_id: 'CAP-1', buyer_transaction_id: 'B-1', custom: 'mallory@example.com' }],
};
const facts = { id: 'PP-D-1', status: 'WAITING_FOR_SELLER_RESPONSE', amount: { minor: 2000, currency: 'USD' }, captureId: 'CAP-1' };

function fakeFetch(respond: (url: string, init: RequestInit) => Response | Promise<Response>) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fetch = async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    return respond(String(url), init ?? {});
  };
  return { fetch: fetch as typeof globalThis.fetch, calls };
}

const lookup = (fetch: typeof globalThis.fetch, timeoutMs = 50) => createPayPalDisputeLookup({ fetch, token: async () => 'TOKEN', timeoutMs });

describe('toDisputeFacts', () => {
  it('maps the id, the status, the disputed amount and the disputed capture', () => {
    expect(toDisputeFacts(dispute)).toEqual(facts);
  });

  it('names no capture when PayPal lists none or several disputed payments', () => {
    expect(toDisputeFacts({ ...dispute, disputed_transactions: [] }).captureId).toBeNull();
    expect(toDisputeFacts({ ...dispute, disputed_transactions: undefined }).captureId).toBeNull();
    const two = [{ seller_transaction_id: 'CAP-1' }, { seller_transaction_id: 'CAP-2' }];
    expect(toDisputeFacts({ ...dispute, disputed_transactions: two }).captureId).toBeNull();
    expect(toDisputeFacts({ ...dispute, disputed_transactions: [{ buyer_transaction_id: 'B-1' }] }).captureId).toBeNull();
  });

  it('refuses an answer without an id, a status or a readable amount', () => {
    expect(() => toDisputeFacts({ status: 'OPEN' })).toThrow('Unreadable PayPal dispute');
    expect(() => toDisputeFacts('nope')).toThrow('Unreadable PayPal dispute');
    expect(() => toDisputeFacts({ ...dispute, dispute_amount: undefined })).toThrow('Unreadable PayPal dispute amount');
    expect(() => toDisputeFacts({ ...dispute, dispute_amount: { currency_code: 'USD', value: '-1' } })).toThrow('Invalid PayPal amount');
  });
});

describe('payPal dispute lookup', () => {
  it('reads the dispute from PayPal with the access token', async () => {
    const { fetch, calls } = fakeFetch(() => Response.json(dispute));
    expect(await lookup(fetch).getDispute('PP-D-1')).toEqual(facts);
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe('https://api-m.sandbox.paypal.com/v1/customer/disputes/PP-D-1');
    expect(calls[0].init.headers).toEqual({ Authorization: 'Bearer TOKEN' });
  });

  it('keeps the id inside the dispute path', async () => {
    const { fetch, calls } = fakeFetch(() => Response.json(dispute));
    await lookup(fetch).getDispute('../../v2/checkout/orders/X');
    expect(calls[0].url).toBe('https://api-m.sandbox.paypal.com/v1/customer/disputes/..%2F..%2Fv2%2Fcheckout%2Forders%2FX');
  });

  it('answers undefined for a dispute PayPal does not know', async () => {
    const { fetch } = fakeFetch(() => new Response('{"name":"RESOURCE_NOT_FOUND"}', { status: 404 }));
    expect(await lookup(fetch).getDispute('PP-D-NOPE')).toBeUndefined();
  });

  it('fails on any other PayPal error', async () => {
    const { fetch } = fakeFetch(() => new Response('boom', { status: 500 }));
    await expect(lookup(fetch).getDispute('PP-D-1')).rejects.toThrow('PayPal 500');
  });

  it('gives up on a PayPal answer that never comes', async () => {
    const { fetch } = fakeFetch(
      (_url, init) =>
        new Promise((_, reject) => {
          init.signal?.addEventListener('abort', () => reject(init.signal?.reason));
        }),
    );
    await expect(lookup(fetch, 20).getDispute('PP-D-1')).rejects.toThrow();
  });
});
