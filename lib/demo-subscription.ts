// The demo's sample subscription: a monthly sandbox plan and one subscription to it, which a
// sandbox personal account approves once through its approval link. After approval its owner is
// that buyer's PayPal email, and the sample cancellation tickets on /support refer to it.
// Created by the button on /support; sandbox money is fictitious.

import { saveSeedSubscription, SEED_FILE } from './demo-seed.ts';
import { accessToken, PAYPAL_API, PayPalApiError } from './paypal.ts';

const PRODUCT_NAME = 'Guard demo membership';
const PLAN_NAME = 'Guard demo monthly';

export type SampleSubscription = { subscriptionId: string; approveUrl: string };

// `appUrl`: where PayPal sends the buyer back after approving; without a return URL its checkout
// loops back to the login instead of activating the subscription.
type Deps = { fetch?: typeof globalThis.fetch; token?: () => Promise<string>; file?: string; appUrl?: string };

function client({ fetch = globalThis.fetch, token = accessToken }: Deps) {
  async function call<T>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> {
    const res = await fetch(`${PAYPAL_API}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${await token()}`,
        'Content-Type': 'application/json',
        // Not retried, but a request id keeps an accidental repeat from creating a second record.
        ...(method === 'POST' && { 'PayPal-Request-Id': crypto.randomUUID() }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      cache: 'no-store',
    });
    if (!res.ok) throw new PayPalApiError(res.status, path.split('?')[0], await res.text());
    return (await res.json()) as T;
  }

  // The first record of a list endpoint that matches, across its pages.
  async function find<T>(path: string, key: string, match: (item: T) => boolean): Promise<T | undefined> {
    for (let page = 1; ; page++) {
      const res = await call<Record<string, unknown> & { total_pages?: number }>('GET', `${path}&page_size=20&page=${page}&total_required=true`);
      const found = ((res[key] as T[] | undefined) ?? []).find(match);
      if (found || page >= (res.total_pages ?? 1)) return found;
    }
  }

  return { call, find };
}

// Reuses the demo product and its active monthly plan by name, so clicking again only adds a
// subscription.
export async function createSampleSubscription(deps: Deps = {}): Promise<SampleSubscription> {
  const { call, find } = client(deps);

  const product =
    (await find<{ id: string; name?: string }>('/v1/catalogs/products?', 'products', (p) => p.name === PRODUCT_NAME)) ??
    (await call<{ id: string }>('POST', '/v1/catalogs/products', {
      name: PRODUCT_NAME,
      description: 'Sample subscription for the payment guard demo',
      type: 'SERVICE',
      category: 'SOFTWARE',
    }));

  const plan =
    (await find<{ id: string; name?: string; status?: string }>(
      `/v1/billing/plans?product_id=${encodeURIComponent(product.id)}`,
      'plans',
      (p) => p.name === PLAN_NAME && p.status === 'ACTIVE',
    )) ??
    (await call<{ id: string }>('POST', '/v1/billing/plans', {
      product_id: product.id,
      name: PLAN_NAME,
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
      payment_preferences: { auto_bill_outstanding: true, payment_failure_threshold: 1 },
    }));

  const back = `${(deps.appUrl || process.env.APP_URL || 'http://localhost:3000').replace(/\/+$/, '')}/support`;
  const subscription = await call<{ id: string; links?: { rel: string; href: string }[] }>('POST', '/v1/billing/subscriptions', {
    plan_id: plan.id,
    application_context: { brand_name: 'Guard demo shop', shipping_preference: 'NO_SHIPPING', user_action: 'SUBSCRIBE_NOW', return_url: back, cancel_url: back },
  });
  const approveUrl = subscription.links?.find((link) => link.rel === 'approve')?.href;
  if (!approveUrl) throw new Error(`Subscription ${subscription.id} came back without an approval link`);

  await saveSeedSubscription({ id: subscription.id, approveUrl, createdAt: new Date().toISOString() }, deps.file ?? SEED_FILE);
  return { subscriptionId: subscription.id, approveUrl };
}
