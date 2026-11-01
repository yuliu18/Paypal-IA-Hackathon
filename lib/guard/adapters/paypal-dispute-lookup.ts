// DisputeLookup backed by the PayPal REST API: a dispute gives its status, the disputed amount
// and the shop's capture it is about. One bounded GET, no retries: the guard fails closed on any error.

import { accessToken, payPalApi, type PaymentEnvironment } from '@/lib/paypal';
import { toMinor } from './paypal-capture-lookup';
import type { DisputeFacts } from '../domain/dispute';
import type { DisputeLookup } from '../ports';

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

export function toDisputeFacts(body: unknown): DisputeFacts {
  if (!isRecord(body) || typeof body.dispute_id !== 'string' || typeof body.status !== 'string') throw new Error('Unreadable PayPal dispute');
  const amount = body.dispute_amount;
  if (!isRecord(amount) || typeof amount.value !== 'string' || typeof amount.currency_code !== 'string') throw new Error('Unreadable PayPal dispute amount');
  // PayPal hides the customer's email from the shop, so the owner comes from the disputed capture
  // (the customer the shop charged). A dispute over several payments names no single capture.
  const transactions = Array.isArray(body.disputed_transactions) ? body.disputed_transactions : [];
  const sellerId = transactions.length === 1 && isRecord(transactions[0]) ? transactions[0].seller_transaction_id : undefined;
  return {
    id: body.dispute_id,
    status: body.status,
    amount: toMinor({ value: amount.value, currency_code: amount.currency_code }),
    captureId: typeof sellerId === 'string' && sellerId ? sellerId : null,
  };
}

export function createPayPalDisputeLookup({
  environment = 'sandbox',
  // Looked up at call time, so the shared default never holds on to a fetch replaced later.
  fetch = (input, init) => globalThis.fetch(input, init),
  token = () => accessToken(environment),
  timeoutMs = 10_000,
}: { environment?: PaymentEnvironment; fetch?: typeof globalThis.fetch; token?: () => Promise<string>; timeoutMs?: number } = {}): DisputeLookup {
  return {
    async getDispute(disputeId) {
      const path = `/v1/customer/disputes/${encodeURIComponent(disputeId)}`;
      const res = await fetch(`${payPalApi(environment)}${path}`, {
        headers: { Authorization: `Bearer ${await token()}` },
        cache: 'no-store',
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (res.status === 404) return undefined;
      if (!res.ok) throw new Error(`PayPal ${res.status} on ${path}: ${(await res.text()).slice(0, 300)}`);
      return toDisputeFacts(await res.json());
    },
  };
}

export const payPalDisputeLookup = createPayPalDisputeLookup();
