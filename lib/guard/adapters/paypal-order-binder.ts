// OrderBinder backed by the PayPal REST API: records a new order as the task customer's by writing
// their email into the order's custom_id, as lib/demo-dispute-payment.ts does for the sample
// payment. create_order can't carry a custom_id, and get_order's owner check reads it. One bounded
// PATCH, no retries: the guard reports any failure.

import { accessToken, PAYPAL_API } from '@/lib/paypal';
import { ORDER_ID } from '../domain/order';
import type { OrderBinder } from '../ports';

export function createPayPalOrderBinder({
  fetch = globalThis.fetch,
  token = accessToken,
  timeoutMs = 10_000,
}: { fetch?: typeof globalThis.fetch; token?: () => Promise<string>; timeoutMs?: number } = {}): OrderBinder {
  return {
    async bindToCustomer(orderId, customerEmail) {
      if (!ORDER_ID.test(orderId)) throw new Error(`${orderId.slice(0, 40)} is not a plain PayPal order id`);
      const path = `/v2/checkout/orders/${orderId}`;
      // The toolkit sends one purchase unit with no reference_id, which PayPal names `default`.
      const res = await fetch(`${PAYPAL_API}${path}`, {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${await token()}`, 'Content-Type': 'application/json' },
        body: JSON.stringify([{ op: 'add', path: "/purchase_units/@reference_id=='default'/custom_id", value: customerEmail }]),
        cache: 'no-store',
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!res.ok) throw new Error(`PayPal ${res.status} on ${path}: ${(await res.text()).slice(0, 300)}`);
    },
  };
}

export const payPalOrderBinder = createPayPalOrderBinder();
