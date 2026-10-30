// The shop's checkout for the sales agent's orders: where PayPal sends the buyer back, and the
// capture once they approved. The agent only creates an order (create_order, through the payment
// guard) and hands the customer its approval link; it never gets pay_order. The shop's own server
// takes the payment here, and only for an order the guard itself created and bound to a customer.

import { ORDER_ID } from '@/lib/guard/domain/order';
import type { AuditLog } from '@/lib/guard/ports';
import { appBase, demoClient, type DemoDeps } from '@/lib/demo-paypal-client';

export const SALES_RETURN_PATH = '/api/sales/paypal-return';
export const SALES_CANCEL_PATH = '/sales?order=cancelled';

// The shop's origin, the only place the guard lets an order send the buyer back to: APP_URL, else
// the local dev server, as the sample payments' return links (lib/demo-paypal-client.ts appBase).
// Never the request's Origin header: whoever sends the chat sets it, and could name their own site.
export function shopOrigin(): string {
  return new URL(appBase()).origin;
}

export function checkoutUrls(origin: string): { returnUrl: string; cancelUrl: string } {
  return { returnUrl: `${origin}${SALES_RETURN_PATH}`, cancelUrl: `${origin}${SALES_CANCEL_PATH}` };
}

type Order = {
  id: string;
  status?: string;
  purchase_units?: { custom_id?: string; amount?: { currency_code?: string; value?: string } }[];
};
type CapturedOrder = { purchase_units?: { payments?: { captures?: { id: string }[] } }[] };

export type CompletedSale = { orderId: string; captureId: string; customerEmail: string; amount: string };

// Where the shop learns which orders the guard created: its audit log.
export type GuardOrderRecords = Pick<AuditLog, 'boundOrderCustomer'>;

// The buyer came back from PayPal having approved `orderId` (?token= on the return link). Captures
// it only when the guard's audit log records creating it and binding it to a customer, PayPal names
// that same customer (custom_id) on its one purchase unit, and the buyer approved it. Anything else
// captures nothing: an order created outside the guard (any merchant app could set a custom_id), a
// log that can't be read, another customer, an extra purchase unit, an order not approved yet, or
// one already paid.
export async function completeSalesOrder(orderId: string, records: GuardOrderRecords, deps: DemoDeps = {}): Promise<CompletedSale> {
  if (!ORDER_ID.test(orderId)) throw new Error(`${orderId.slice(0, 40)} is not a PayPal order id`);
  let boundTo: string | undefined;
  try {
    boundTo = await records.boundOrderCustomer(orderId);
  } catch (error) {
    throw new Error(`Order ${orderId} could not be checked against the payment guard's log: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (!boundTo) throw new Error(`Order ${orderId} is not an order the payment guard created for a customer`);

  const { call } = demoClient(deps);
  const path = `/v2/checkout/orders/${orderId}`;
  const order = await call<Order>('GET', path);
  const units = order.purchase_units ?? [];
  const unit = units[0];
  const customerEmail = unit?.custom_id;
  if (!customerEmail) throw new Error(`Order ${orderId} is not bound to a customer of the shop`);
  if (units.length !== 1 || units.some((u) => u.custom_id !== boundTo)) {
    throw new Error(`Order ${orderId} is not bound to the customer the payment guard created it for`);
  }
  if (order.status !== 'APPROVED') throw new Error(`Order ${orderId} is ${order.status ?? 'unknown'}, not approved by the buyer`);

  const captured = await call<CapturedOrder>('POST', `${path}/capture`, {});
  const captureId = captured.purchase_units?.[0]?.payments?.captures?.[0]?.id;
  if (!captureId) throw new Error(`Order ${orderId} was captured without a capture id`);
  return { orderId, captureId, customerEmail, amount: `${unit?.amount?.value ?? '?'} ${unit?.amount?.currency_code ?? ''}`.trim() };
}
