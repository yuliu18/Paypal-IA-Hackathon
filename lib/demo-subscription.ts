// The demo's sample subscription: a monthly sandbox plan and one subscription to it, which a
// sandbox personal account approves once through its approval link. After approval its owner is
// that buyer's PayPal email, and the sample cancellation tickets on /support refer to it.
// Created by the button on /support; sandbox money is fictitious.

import { saveSeedSubscription, SEED_FILE } from './demo-seed.ts';
import { appBase, demoClient, type DemoDeps } from './demo-paypal-client.ts';

const PRODUCT_NAME = 'Guard demo membership';
const PLAN_NAME = 'Guard demo monthly';

export type SampleSubscription = { subscriptionId: string; approveUrl: string };

// Reuses the demo product and its active monthly plan by name, so clicking again only adds a
// subscription.
export async function createSampleSubscription(deps: DemoDeps = {}): Promise<SampleSubscription> {
  const { call, find } = demoClient(deps);

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

  const back = `${appBase(deps.appUrl)}/support`;
  const subscription = await call<{ id: string; links?: { rel: string; href: string }[] }>('POST', '/v1/billing/subscriptions', {
    plan_id: plan.id,
    application_context: { brand_name: 'Guard demo shop', shipping_preference: 'NO_SHIPPING', user_action: 'SUBSCRIBE_NOW', return_url: back, cancel_url: back },
  });
  const approveUrl = subscription.links?.find((link) => link.rel === 'approve')?.href;
  if (!approveUrl) throw new Error(`Subscription ${subscription.id} came back without an approval link`);

  await saveSeedSubscription({ id: subscription.id, approveUrl, createdAt: new Date().toISOString() }, deps.file ?? SEED_FILE);
  return { subscriptionId: subscription.id, approveUrl };
}
