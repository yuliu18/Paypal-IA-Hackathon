// A small PayPal REST client for the demo's sample data (lib/demo-subscription.ts,
// lib/demo-dispute-payment.ts). Sandbox only, like everything the demo creates.

import { accessToken, PAYPAL_API, PayPalApiError } from './paypal.ts';

// `appUrl`: where PayPal sends the buyer back after approving; without a return URL its checkout
// loops back to the login instead of completing.
export type DemoDeps = { fetch?: typeof globalThis.fetch; token?: () => Promise<string>; file?: string; appUrl?: string };

// The app's base URL for PayPal's return links: the request's origin, else APP_URL, else local.
export const appBase = (appUrl?: string) => (appUrl || process.env.APP_URL || 'http://localhost:3000').replace(/\/+$/, '');

export function demoClient({ fetch = globalThis.fetch, token = accessToken }: DemoDeps) {
  async function call<T>(method: 'GET' | 'POST' | 'PATCH', path: string, body?: unknown): Promise<T> {
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
