// The demo's sample PayPal payment: a 20 USD order a sandbox personal account pays with PayPal
// (the sample card payments can't be disputed), so the buyer can then open a dispute on it in the
// sandbox Resolution Center. When the buyer comes back, the shop writes the buyer's PayPal email
// into the order's custom_id, as a shop records its customer, and captures it: the guard reads
// whose payment it is from there. Created by the button on /support; sandbox money is fictitious.

import { readSeedDisputePayment, saveSeedDisputePayment, SEED_FILE } from './demo-seed.ts';
import { appBase, demoClient, type DemoDeps } from './demo-paypal-client.ts';

export const RETURN_PATH = '/api/support/paypal-return';

type Link = { rel: string; href: string };
type Order = { id: string; status?: string; payer?: { email_address?: string }; links?: Link[] };
type CapturedOrder = { purchase_units?: { payments?: { captures?: { id: string; status?: string }[] } }[] };

export async function createSampleDisputePayment(deps: DemoDeps = {}): Promise<{ orderId: string; approveUrl: string }> {
  const { call } = demoClient(deps);
  const base = appBase(deps.appUrl);
  const order = await call<Order>('POST', '/v2/checkout/orders', {
    intent: 'CAPTURE',
    purchase_units: [{ reference_id: 'default', description: 'Guard demo headphones', amount: { currency_code: 'USD', value: '20.00' } }],
    application_context: {
      brand_name: 'Guard demo shop',
      shipping_preference: 'NO_SHIPPING',
      user_action: 'PAY_NOW',
      return_url: `${base}${RETURN_PATH}`,
      cancel_url: `${base}/support`,
    },
  });
  const approveUrl = order.links?.find((link) => link.rel === 'approve' || link.rel === 'payer-action')?.href;
  if (!approveUrl) throw new Error(`Order ${order.id} came back without an approval link`);
  await saveSeedDisputePayment({ orderId: order.id, approveUrl, createdAt: new Date().toISOString() }, deps.file ?? SEED_FILE);
  return { orderId: order.id, approveUrl };
}

// The buyer came back from PayPal having approved `orderId`. Only the order the button created,
// and only once: any other id, from a link someone crafted, captures nothing.
export async function completeSampleDisputePayment(orderId: string, deps: DemoDeps = {}): Promise<{ captureId: string; customerEmail: string }> {
  const file = deps.file ?? SEED_FILE;
  const seed = await readSeedDisputePayment(file);
  if (!seed || seed.orderId !== orderId) throw new Error(`Order ${orderId} is not the sample PayPal payment`);
  if (seed.captureId && seed.customerEmail) return { captureId: seed.captureId, customerEmail: seed.customerEmail };

  const { call } = demoClient(deps);
  const path = `/v2/checkout/orders/${encodeURIComponent(orderId)}`;
  const order = await call<Order>('GET', path);
  const customerEmail = order.payer?.email_address;
  if (order.status !== 'APPROVED' || !customerEmail) throw new Error(`Order ${orderId} is ${order.status ?? 'unknown'}, not approved by a PayPal buyer`);

  await call('PATCH', path, [{ op: 'add', path: "/purchase_units/@reference_id=='default'/custom_id", value: customerEmail }]);
  const captured = await call<CapturedOrder>('POST', `${path}/capture`, {});
  const captureId = captured.purchase_units?.[0]?.payments?.captures?.[0]?.id;
  if (!captureId) throw new Error(`Order ${orderId} was captured without a capture id`);

  await saveSeedDisputePayment({ ...seed, captureId, customerEmail }, file);
  return { captureId, customerEmail };
}

export type SampleDispute = { id: string; status: string };

// The newest dispute the buyer opened on the sample payment, for the /support tickets to quote.
// Read by the page, not the agent: list_disputes stays blocked for the agent, since it lists every
// customer's disputes.
export async function findSampleDispute(captureId: string, deps: DemoDeps = {}): Promise<SampleDispute | undefined> {
  const { call } = demoClient(deps);
  const list = await call<{ items?: { dispute_id?: string; status?: string; create_time?: string }[] }>(
    'GET',
    `/v1/customer/disputes?disputed_transaction_id=${encodeURIComponent(captureId)}`,
  );
  const newest = [...(list.items ?? [])].sort((a, b) => String(b.create_time).localeCompare(String(a.create_time)))[0];
  return newest?.dispute_id && newest.status ? { id: newest.dispute_id, status: newest.status } : undefined;
}
