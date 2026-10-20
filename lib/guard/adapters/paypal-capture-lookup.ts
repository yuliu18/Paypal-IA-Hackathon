// CaptureLookup backed by the PayPal REST API: a capture plus its order give the amount,
// what is already refunded, and who paid.

import { getCapture, getOrder, type Capture, type Money as PayPalMoney, type Order } from '@/lib/paypal';
import type { CaptureFacts, Money } from '../domain/policy';
import type { CaptureLookup } from '../ports';

// Refunds in these states no longer hold money back from the capture.
const RELEASED_REFUND_STATUSES = new Set(['FAILED', 'CANCELLED']);

export function toMinor(m: PayPalMoney): Money {
  const [whole, fraction = ''] = m.value.split('.');
  const sign = whole.startsWith('-') ? -1 : 1;
  return { minor: sign * (Math.abs(Number(whole)) * 100 + Number(fraction.padEnd(2, '0').slice(0, 2))), currency: m.currency_code };
}

export function toCaptureFacts(capture: Capture, order: Order): CaptureFacts {
  const captured = toMinor(capture.amount);
  const unit = order.purchase_units?.find((u) => u.payments?.captures?.some((c) => c.id === capture.id));
  const refunded = (unit?.payments?.refunds ?? [])
    .filter((r) => r.amount && !RELEASED_REFUND_STATUSES.has(r.status))
    .reduce((sum, r) => sum + toMinor(r.amount!).minor, 0);

  return {
    captureId: capture.id,
    status: capture.status,
    captured,
    refunded: { minor: refunded, currency: captured.currency },
    payerEmail: order.payer?.email_address ?? null,
  };
}

export const payPalCaptureLookup: CaptureLookup = {
  async getCapture(captureId) {
    const capture = await getCapture(captureId);
    const orderId = capture.supplementary_data?.related_ids?.order_id;
    if (!orderId) throw new Error(`Capture ${captureId} has no related order`);
    return toCaptureFacts(capture, await getOrder(orderId));
  },
};
