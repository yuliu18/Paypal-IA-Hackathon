import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readSeedDisputePayment, saveSeedDisputePayment } from './demo-seed';
import { completeSampleDisputePayment, createSampleDisputePayment, findSampleDispute } from './demo-dispute-payment';

let dir: string;
let file: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'demo-dispute-'));
  file = join(dir, 'data', 'seed.json');
});
afterEach(() => rm(dir, { recursive: true, force: true }));

type Sent = { method: string; path: string; body?: unknown };

// A fake PayPal: answers by method and path, and records every request.
function fakePayPal(routes: Record<string, (body: unknown) => { status?: number; json?: unknown }>) {
  const sent: Sent[] = [];
  const fetch = (async (url: string, init: RequestInit = {}) => {
    const { pathname, search } = new URL(url);
    const method = init.method ?? 'GET';
    const body = typeof init.body === 'string' ? JSON.parse(init.body) : undefined;
    sent.push({ method, path: pathname + search, body });
    const route = routes[`${method} ${pathname}`];
    if (!route) return new Response('not found', { status: 404 });
    const { status = 200, json } = route(body);
    return status === 204 ? new Response(null, { status }) : Response.json(json, { status });
  }) as typeof globalThis.fetch;
  return { fetch, sent };
}

const token = async () => 'TOKEN';
const APPROVE = 'https://www.sandbox.paypal.com/checkoutnow?token=O-1';

describe('createSampleDisputePayment', () => {
  it('creates a 20 USD order that sends the buyer back to the return route, and records it', async () => {
    const { fetch, sent } = fakePayPal({
      'POST /v2/checkout/orders': () => ({ status: 201, json: { id: 'O-1', status: 'CREATED', links: [{ rel: 'approve', href: APPROVE }] } }),
    });
    expect(await createSampleDisputePayment({ fetch, token, file, appUrl: 'https://shop.example/' })).toEqual({ orderId: 'O-1', approveUrl: APPROVE });
    expect(sent[0].body).toMatchObject({
      intent: 'CAPTURE',
      purchase_units: [{ reference_id: 'default', amount: { currency_code: 'USD', value: '20.00' } }],
      application_context: { return_url: 'https://shop.example/api/support/paypal-return', cancel_url: 'https://shop.example/support' },
    });
    expect(await readSeedDisputePayment(file)).toMatchObject({ orderId: 'O-1', approveUrl: APPROVE });
  });

  it('fails without touching the seed when PayPal gives no approval link', async () => {
    const { fetch } = fakePayPal({ 'POST /v2/checkout/orders': () => ({ status: 201, json: { id: 'O-2', links: [] } }) });
    await expect(createSampleDisputePayment({ fetch, token, file })).rejects.toThrow(/approval link/);
    expect(await readSeedDisputePayment(file)).toBeUndefined();
  });
});

describe('completeSampleDisputePayment', () => {
  const approved = () => ({ json: { id: 'O-1', status: 'APPROVED', payer: { email_address: 'buyer@personal.example.com' } } });
  const captured = () => ({ status: 201, json: { purchase_units: [{ payments: { captures: [{ id: 'CAP-9', status: 'COMPLETED' }] } }] } });

  beforeEach(() => saveSeedDisputePayment({ orderId: 'O-1', approveUrl: APPROVE, createdAt: '2026-10-24T00:00:00.000Z' }, file));

  it("records the buyer's PayPal email as the order's customer, then captures it", async () => {
    const { fetch, sent } = fakePayPal({
      'GET /v2/checkout/orders/O-1': approved,
      'PATCH /v2/checkout/orders/O-1': () => ({ status: 204 }),
      'POST /v2/checkout/orders/O-1/capture': captured,
    });
    expect(await completeSampleDisputePayment('O-1', { fetch, token, file })).toEqual({ captureId: 'CAP-9', customerEmail: 'buyer@personal.example.com' });
    expect(sent.map((r) => `${r.method} ${r.path}`)).toEqual(['GET /v2/checkout/orders/O-1', 'PATCH /v2/checkout/orders/O-1', 'POST /v2/checkout/orders/O-1/capture']);
    expect(sent[1].body).toEqual([{ op: 'add', path: "/purchase_units/@reference_id=='default'/custom_id", value: 'buyer@personal.example.com' }]);
    expect(await readSeedDisputePayment(file)).toMatchObject({ orderId: 'O-1', captureId: 'CAP-9', customerEmail: 'buyer@personal.example.com' });
  });

  it('captures nothing for an order the button did not create', async () => {
    const { fetch, sent } = fakePayPal({});
    await expect(completeSampleDisputePayment('O-OTHER', { fetch, token, file })).rejects.toThrow('not the sample PayPal payment');
    expect(sent).toEqual([]);
  });

  it('captures only once: a second return answers what was recorded', async () => {
    await saveSeedDisputePayment({ orderId: 'O-1', approveUrl: APPROVE, createdAt: '', captureId: 'CAP-9', customerEmail: 'buyer@personal.example.com' }, file);
    const { fetch, sent } = fakePayPal({});
    expect(await completeSampleDisputePayment('O-1', { fetch, token, file })).toEqual({ captureId: 'CAP-9', customerEmail: 'buyer@personal.example.com' });
    expect(sent).toEqual([]);
  });

  it('refuses an order the buyer has not approved', async () => {
    const { fetch, sent } = fakePayPal({ 'GET /v2/checkout/orders/O-1': () => ({ json: { id: 'O-1', status: 'CREATED' } }) });
    await expect(completeSampleDisputePayment('O-1', { fetch, token, file })).rejects.toThrow('not approved');
    expect(sent).toHaveLength(1);
    expect((await readSeedDisputePayment(file))?.captureId).toBeUndefined();
  });
});

describe('findSampleDispute', () => {
  it('returns the newest dispute on the sample capture', async () => {
    const { fetch, sent } = fakePayPal({
      'GET /v1/customer/disputes': () => ({
        json: {
          items: [
            { dispute_id: 'PP-D-OLD', status: 'RESOLVED', create_time: '2026-10-20T00:00:00Z' },
            { dispute_id: 'PP-D-NEW', status: 'WAITING_FOR_SELLER_RESPONSE', create_time: '2026-10-24T00:00:00Z' },
          ],
        },
      }),
    });
    expect(await findSampleDispute('CAP-9', { fetch, token })).toEqual({ id: 'PP-D-NEW', status: 'WAITING_FOR_SELLER_RESPONSE' });
    expect(sent[0].path).toBe('/v1/customer/disputes?disputed_transaction_id=CAP-9');
  });

  it('returns nothing before the buyer opens a dispute', async () => {
    const { fetch } = fakePayPal({ 'GET /v1/customer/disputes': () => ({ json: {} }) });
    expect(await findSampleDispute('CAP-9', { fetch, token })).toBeUndefined();
  });
});
