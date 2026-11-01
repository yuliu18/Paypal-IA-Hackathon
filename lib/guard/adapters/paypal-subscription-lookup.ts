// SubscriptionLookup backed by the PayPal REST API: a subscription gives its status and the
// subscriber it belongs to. One bounded GET, no retries: the guard fails closed on any error.

import { accessToken, payPalApi, type PaymentEnvironment } from '@/lib/paypal';
import type { SubscriptionFacts } from '../domain/cancellation';
import type { SubscriptionLookup } from '../ports';

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

export function toSubscriptionFacts(body: unknown): SubscriptionFacts {
  if (!isRecord(body) || typeof body.id !== 'string' || typeof body.status !== 'string') throw new Error('Unreadable PayPal subscription');
  // The owner is the PayPal account that approved the subscription; custom_id is whatever the shop
  // wrote, so it never stands in for a missing subscriber.
  const email = isRecord(body.subscriber) ? body.subscriber.email_address : undefined;
  return { id: body.id, status: body.status, customerEmail: typeof email === 'string' ? email : null };
}

export function createPayPalSubscriptionLookup({
  environment = 'sandbox',
  // Looked up at call time, so the shared default never holds on to a fetch replaced later.
  fetch = (input, init) => globalThis.fetch(input, init),
  token = () => accessToken(environment),
  timeoutMs = 10_000,
}: { environment?: PaymentEnvironment; fetch?: typeof globalThis.fetch; token?: () => Promise<string>; timeoutMs?: number } = {}): SubscriptionLookup {
  return {
    async getSubscription(subscriptionId) {
      const path = `/v1/billing/subscriptions/${encodeURIComponent(subscriptionId)}`;
      const res = await fetch(`${payPalApi(environment)}${path}`, {
        headers: { Authorization: `Bearer ${await token()}` },
        cache: 'no-store',
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (res.status === 404) return undefined;
      if (!res.ok) throw new Error(`PayPal ${res.status} on ${path}: ${(await res.text()).slice(0, 300)}`);
      return toSubscriptionFacts(await res.json());
    },
  };
}

export const payPalSubscriptionLookup = createPayPalSubscriptionLookup();
