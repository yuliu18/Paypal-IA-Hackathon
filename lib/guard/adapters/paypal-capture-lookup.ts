// CaptureLookup backed by the PayPal REST API: a capture plus its order give the amount,
// what is already refunded, and which customer the shop charged.

import { getCapture, getOrder, type Capture, type Money as PayPalMoney, type Order, type PaymentEnvironment } from '@/lib/paypal';
import type { CaptureFacts, Money } from '../domain/policy';
import type { CaptureLookup } from '../ports';

// Refunds in these states no longer hold money back from the capture.
const RELEASED_REFUND_STATUSES = new Set(['FAILED', 'CANCELLED']);

const DECIMAL = /^\d+(\.\d+)?$/;

// Anything but a plain decimal would become NaN, and NaN comparisons pass every limit check.
// Negative amounts are rejected too: a negative refund would shrink the refunded total and
// inflate what is still refundable.
export function toMinor(m: PayPalMoney): Money {
  if (!DECIMAL.test(m.value)) throw new Error(`Invalid PayPal amount "${m.value}"`);
  const [whole, fraction = ''] = m.value.split('.');
  return { minor: Number(whole) * 100 + Number(fraction.padEnd(2, '0').slice(0, 2)), currency: m.currency_code };
}

export function toCaptureFacts(capture: Capture, order: Order): CaptureFacts {
  const captured = toMinor(capture.amount);
  const unit = order.purchase_units?.find((u) => u.payments?.captures?.some((c) => c.id === capture.id));
  const holding = (unit?.payments?.refunds ?? []).filter((r) => r.amount && !RELEASED_REFUND_STATUSES.has(r.status));
  const sum = (refunds: typeof holding) => refunds.reduce((total, r) => total + toMinor(r.amount!).minor, 0);

  return {
    captureId: capture.id,
    status: capture.status,
    statusReason: capture.status_details?.reason ?? null,
    captured,
    refunded: { minor: sum(holding), currency: captured.currency },
    pendingRefunded: { minor: sum(holding.filter((r) => r.status === 'PENDING')), currency: captured.currency },
    // The shop's server writes the customer into custom_id when it charges; card payments carry
    // no payer email, and the buyer can't change custom_id.
    customerEmail: unit?.custom_id ?? null,
  };
}

// `environment`: the PayPal environment the request runs in; the sandbox unless told otherwise.
export function createPayPalCaptureLookup({ environment = 'sandbox' }: { environment?: PaymentEnvironment } = {}): CaptureLookup {
  return {
    async getCapture(captureId) {
      const capture = await getCapture(captureId, environment);
      const orderId = capture.supplementary_data?.related_ids?.order_id;
      if (!orderId) throw new Error(`Capture ${captureId} has no related order`);
      return toCaptureFacts(capture, await getOrder(orderId, environment));
    },
  };
}

export const payPalCaptureLookup = createPayPalCaptureLookup();
