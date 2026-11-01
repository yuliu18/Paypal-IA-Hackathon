// A small PayPal REST client for the demo's sample data (lib/demo-subscription.ts,
// lib/demo-dispute-payment.ts) and the shop's checkout (lib/shop/checkout.ts). The sandbox, like
// everything the demo creates, unless the checkout passes the environment of a live order.

import { accessToken, payPalApi, PayPalApiError, type PaymentEnvironment } from './paypal.ts';

// `appUrl`: where PayPal sends the buyer back after approving; without a return URL its checkout
// loops back to the login instead of completing.
// `environment`: only the checkout of a live order passes 'live'; the sample data never does.
export type DemoDeps = { fetch?: typeof globalThis.fetch; token?: () => Promise<string>; file?: string; appUrl?: string; environment?: PaymentEnvironment };

// The app's base URL for PayPal's return links: the request's origin, else APP_URL, else local.
export const appBase = (appUrl?: string) => (appUrl || process.env.APP_URL || 'http://localhost:3000').replace(/\/+$/, '');

export function demoClient({ environment = 'sandbox', fetch = globalThis.fetch, token = () => accessToken(environment) }: DemoDeps) {
  async function call<T>(method: 'GET' | 'POST' | 'PATCH', path: string, body?: unknown): Promise<T> {
    const res = await fetch(`${payPalApi(environment)}${path}`, {
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
    // PATCH answers 204 with no body.
    return (res.status === 204 ? undefined : await res.json()) as T;
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
