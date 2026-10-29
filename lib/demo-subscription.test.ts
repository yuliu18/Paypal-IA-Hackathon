import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readSeed, readSeedSubscription } from './demo-seed';
import { createSampleSubscription } from './demo-subscription';

let dir: string;
let file: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'demo-subscription-'));
  file = join(dir, 'data', 'seed.json');
});
afterEach(() => rm(dir, { recursive: true, force: true }));

type Sent = { method: string; path: string; body?: unknown; headers: Record<string, string> };

// A fake PayPal: answers by method and path, and records every request.
function fakePayPal(routes: Record<string, (body: unknown) => { status?: number; json: unknown }>) {
  const sent: Sent[] = [];
  const fetch = (async (url: string, init: RequestInit = {}) => {
    const { pathname, search } = new URL(url);
    const method = init.method ?? 'GET';
    const body = typeof init.body === 'string' ? JSON.parse(init.body) : undefined;
    sent.push({ method, path: pathname + search, body, headers: init.headers as Record<string, string> });
    const route = routes[`${method} ${pathname}`];
    if (!route) return new Response('not found', { status: 404 });
    const { status = 200, json } = route(body);
    return new Response(JSON.stringify(json), { status, headers: { 'Content-Type': 'application/json' } });
  }) as typeof globalThis.fetch;
  return { fetch, sent };
}

const APPROVE = 'https://www.sandbox.paypal.com/webapps/billing/subscriptions?ba_token=BA-1';
const subscriptionCreated = () => ({
  status: 201,
  json: {
    id: 'I-SUB1',
    status: 'APPROVAL_PENDING',
    links: [
      { rel: 'approve', href: APPROVE, method: 'GET' },
      { rel: 'self', href: 'https://api-m.sandbox.paypal.com/v1/billing/subscriptions/I-SUB1', method: 'GET' },
    ],
  },
});
const token = async () => 'TOKEN';

describe('createSampleSubscription', () => {
  it('creates a product, a monthly plan and a subscription, and returns its approval link', async () => {
    const { fetch, sent } = fakePayPal({
      'GET /v1/catalogs/products': () => ({ json: { products: [{ id: 'PROD-OTHER', name: 'Something else' }], total_pages: 1 } }),
      'POST /v1/catalogs/products': () => ({ status: 201, json: { id: 'PROD-1' } }),
      'GET /v1/billing/plans': () => ({ json: { plans: [], total_pages: 1 } }),
      'POST /v1/billing/plans': () => ({ status: 201, json: { id: 'P-1', status: 'ACTIVE' } }),
      'POST /v1/billing/subscriptions': subscriptionCreated,
    });

    const result = await createSampleSubscription({ fetch, token, file });

    expect(result).toEqual({ subscriptionId: 'I-SUB1', approveUrl: APPROVE });
    const posts = sent.filter((r) => r.method === 'POST');
    expect(posts.map((r) => r.path)).toEqual(['/v1/catalogs/products', '/v1/billing/plans', '/v1/billing/subscriptions']);
    expect(posts[0].body).toMatchObject({ name: 'Guard demo membership', type: 'SERVICE' });
    expect(posts[1].body).toMatchObject({
      product_id: 'PROD-1',
      name: 'Guard demo monthly',
      status: 'ACTIVE',
      billing_cycles: [
        {
          frequency: { interval_unit: 'MONTH', interval_count: 1 },
          tenure_type: 'REGULAR',
          sequence: 1,
          total_cycles: 0,
          pricing_scheme: { fixed_price: { value: '9.99', currency_code: 'USD' } },
        },
      ],
    });
    expect(posts[2].body).toMatchObject({ plan_id: 'P-1' });
    for (const request of sent) expect(request.headers.Authorization).toBe('Bearer TOKEN');
    // A repeated POST must not create a second record.
    for (const post of posts) expect(post.headers['PayPal-Request-Id']).toBeTruthy();
    // The plans are looked up for the product just created.
    expect(sent.find((r) => r.path.startsWith('/v1/billing/plans?'))?.path).toContain('product_id=PROD-1');
  });

  it('sends the buyer back to /support after approving, without which PayPal loops back to its login', async () => {
    const { fetch, sent } = fakePayPal({
      'GET /v1/catalogs/products': () => ({ json: { products: [{ id: 'PROD-1', name: 'Guard demo membership' }], total_pages: 1 } }),
      'GET /v1/billing/plans': () => ({ json: { plans: [{ id: 'P-1', name: 'Guard demo monthly', status: 'ACTIVE' }], total_pages: 1 } }),
      'POST /v1/billing/subscriptions': subscriptionCreated,
    });
    await createSampleSubscription({ fetch, token, file, appUrl: 'https://shop.example/' });
    const context = (sent.find((r) => r.path === '/v1/billing/subscriptions')?.body as { application_context: Record<string, string> }).application_context;
    expect(context).toMatchObject({ return_url: 'https://shop.example/support', cancel_url: 'https://shop.example/support' });
  });

  it('reuses the demo product and its active plan by name', async () => {
    const { fetch, sent } = fakePayPal({
      'GET /v1/catalogs/products': () => ({ json: { products: [{ id: 'PROD-9', name: 'Guard demo membership' }], total_pages: 1 } }),
      'GET /v1/billing/plans': () => ({
        json: {
          plans: [
            { id: 'P-OLD', name: 'Guard demo monthly', status: 'INACTIVE' },
            { id: 'P-9', name: 'Guard demo monthly', status: 'ACTIVE' },
          ],
          total_pages: 1,
        },
      }),
      'POST /v1/billing/subscriptions': subscriptionCreated,
    });

    await createSampleSubscription({ fetch, token, file });

    expect(sent.filter((r) => r.method === 'POST').map((r) => [r.path, r.body])).toEqual([
      ['/v1/billing/subscriptions', expect.objectContaining({ plan_id: 'P-9' })],
    ]);
  });

  it('stores the subscription in the seed file next to the sample payments', async () => {
    const charges = [{ customerEmail: 'ana@example.com', description: 'Mug', amount: { value: '1.00', currency_code: 'USD' }, orderId: 'O-1', captureId: 'C-1', status: 'COMPLETED' }];
    await import('node:fs/promises').then((fs) => fs.mkdir(join(dir, 'data'), { recursive: true }));
    await writeFile(file, JSON.stringify({ createdAt: '2026-10-01T00:00:00.000Z', charges }));
    const { fetch } = fakePayPal({
      'GET /v1/catalogs/products': () => ({ json: { products: [{ id: 'PROD-9', name: 'Guard demo membership' }], total_pages: 1 } }),
      'GET /v1/billing/plans': () => ({ json: { plans: [{ id: 'P-9', name: 'Guard demo monthly', status: 'ACTIVE' }], total_pages: 1 } }),
      'POST /v1/billing/subscriptions': subscriptionCreated,
    });

    await createSampleSubscription({ fetch, token, file });

    expect(await readSeed(file)).toEqual(charges);
    expect(await readSeedSubscription(file)).toMatchObject({ id: 'I-SUB1', approveUrl: APPROVE });
    expect(JSON.parse(await readFile(file, 'utf8')).createdAt).toBe('2026-10-01T00:00:00.000Z');
  });

  it('fails without touching the seed when PayPal gives no approval link', async () => {
    const { fetch } = fakePayPal({
      'GET /v1/catalogs/products': () => ({ json: { products: [{ id: 'PROD-9', name: 'Guard demo membership' }], total_pages: 1 } }),
      'GET /v1/billing/plans': () => ({ json: { plans: [{ id: 'P-9', name: 'Guard demo monthly', status: 'ACTIVE' }], total_pages: 1 } }),
      'POST /v1/billing/subscriptions': () => ({ status: 201, json: { id: 'I-SUB2', status: 'APPROVAL_PENDING', links: [] } }),
    });

    await expect(createSampleSubscription({ fetch, token, file })).rejects.toThrow(/approval link/);
    expect(await readSeedSubscription(file)).toBeUndefined();
  });

  it('reports a PayPal error with its status and path', async () => {
    const { fetch } = fakePayPal({
      'GET /v1/catalogs/products': () => ({ status: 500, json: { name: 'INTERNAL_SERVER_ERROR' } }),
    });
    await expect(createSampleSubscription({ fetch, token, file })).rejects.toThrow(/PayPal 500 on \/v1\/catalogs\/products/);
  });
});
