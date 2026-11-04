// Fills the PayPal sandbox with a shop's last months for the dashboard (lib/showcase-seed.ts):
// invoices to many customers, paid, partly paid, overdue or open; card payments today; the shop's
// products and subscription plans. Every run adds a new batch; sandbox money is fictitious.
// New card payments and invoice payments can take up to three hours to show in Transaction Search.
// Run with: npm run seed:showcase [-- --invoices 60 --charges 16 --seed 1]

import { parseArgs } from 'node:util';
import { accessToken, chargeCard, listPlans, listProducts, PAYPAL_APIS, PayPalApiError } from '../lib/paypal.ts';
import { invoiceBody, SHOWCASE_PLANS, SHOWCASE_PRODUCTS, seededRandom, showcasePlan, type PlannedInvoice } from '../lib/showcase-seed.ts';

const { values } = parseArgs({ options: { invoices: { type: 'string', default: '60' }, charges: { type: 'string', default: '16' }, seed: { type: 'string' } } });
const seed = Number(values.seed ?? Date.now() % 1_000_000);

async function call<T>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    const res = await fetch(`${PAYPAL_APIS.sandbox}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${await accessToken()}`,
        'Content-Type': 'application/json',
        Prefer: 'return=representation',
        // The same id on a retry, so PayPal never creates the same thing twice.
        ...(method === 'POST' && { 'PayPal-Request-Id': `showcase-${seed}-${path}-${JSON.stringify(body ?? '').length}-${hash(JSON.stringify(body ?? ''))}` }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (res.ok) return (res.status === 204 ? undefined : await res.json().catch(() => undefined)) as T;
    if ((res.status === 429 || res.status >= 500) && attempt < 4) {
      await new Promise((resolve) => setTimeout(resolve, 1500 * attempt));
      continue;
    }
    throw new PayPalApiError(res.status, path, await res.text());
  }
}

function hash(text: string): string {
  let h = 0;
  for (const char of text) h = (Math.imul(h, 31) + char.charCodeAt(0)) | 0;
  return (h >>> 0).toString(36);
}

// Runs `work` on every item, `width` at a time: the sandbox rate-limits bursts.
async function inBatches<T>(items: T[], width: number, work: (item: T, index: number) => Promise<void>) {
  for (let i = 0; i < items.length; i += width) await Promise.all(items.slice(i, i + width).map((item, j) => work(item, i + j)));
}

type Created = { id: string; amount?: { value: string; currency_code: string } };

async function createInvoice(invoice: PlannedInvoice): Promise<string> {
  const created = await call<Created>('POST', '/v2/invoicing/invoices', invoiceBody(invoice));
  const id = created.id;
  if (invoice.outcome === 'draft') return `${id} draft`;
  await call('POST', `/v2/invoicing/invoices/${id}/send`, { send_to_recipient: false, send_to_invoicer: false });
  if (invoice.outcome === 'cancelled') {
    await call('POST', `/v2/invoicing/invoices/${id}/cancel`, { send_to_recipient: false, send_to_invoicer: false });
    return `${id} cancelled`;
  }
  if (!invoice.payment) return `${id} ${invoice.outcome}`;
  const { amount } = await call<Created>('GET', `/v2/invoicing/invoices/${id}`);
  if (!amount) throw new Error(`Invoice ${id} has no amount`);
  const value = (Math.round(Number(amount.value) * invoice.payment.share * 100) / 100).toFixed(2);
  await call('POST', `/v2/invoicing/invoices/${id}/payments`, {
    method: invoice.payment.method,
    payment_date: invoice.payment.date,
    amount: { currency_code: amount.currency_code, value },
  });
  return `${id} ${invoice.outcome} ${value} ${amount.currency_code} on ${invoice.payment.date}`;
}

async function createCatalog() {
  const [products, plans] = await Promise.all([listProducts(), listPlans()]);
  const byName = new Map(products.map((p) => [p.name, p.id]));
  for (const product of SHOWCASE_PRODUCTS) {
    if (byName.has(product.name)) continue;
    const created = await call<Created>('POST', '/v1/catalogs/products', product);
    byName.set(product.name, created.id);
    console.log(`product  ${product.name}`);
  }
  const boxId = byName.get('Ceramic mug set')!;
  for (const plan of SHOWCASE_PLANS) {
    if (plans.some((p) => p.name === plan.name)) continue;
    await call('POST', '/v1/billing/plans', {
      product_id: boxId,
      name: plan.name,
      status: 'ACTIVE',
      billing_cycles: [{ frequency: { interval_unit: plan.unit, interval_count: 1 }, tenure_type: 'REGULAR', sequence: 1, total_cycles: 0, pricing_scheme: { fixed_price: { value: plan.price, currency_code: 'USD' } } }],
      payment_preferences: { auto_bill_outstanding: true, payment_failure_threshold: 2 },
    });
    console.log(`plan     ${plan.name}`);
  }
}

const plan = showcasePlan({ today: new Date(), random: seededRandom(seed), count: Number(values.invoices), charges: Number(values.charges) });
console.log(`Seed ${seed}: ${plan.invoices.length} invoices, ${plan.charges.length} card payments`);

await createCatalog();

let failed = 0;
await inBatches(plan.invoices, 3, async (invoice, i) => {
  try {
    console.log(`invoice  ${String(i + 1).padStart(3)} ${invoice.invoiceDate} ${invoice.customer.email.padEnd(32)} ${await createInvoice(invoice)}`);
  } catch (error) {
    failed++;
    console.error(`invoice  ${String(i + 1).padStart(3)} ${invoice.invoiceDate} ${invoice.customer.email} failed: ${error instanceof Error ? error.message : error}`);
  }
});
await inBatches(plan.charges, 3, async (charge) => {
  try {
    const { captureId } = await chargeCard({ customerEmail: charge.customerEmail, description: charge.product, amount: { value: charge.value, currency_code: 'USD' } });
    console.log(`card     ${charge.customerEmail.padEnd(32)} ${charge.value.padStart(7)} USD  ${charge.product}  capture ${captureId}`);
  } catch (error) {
    failed++;
    console.error(`card     ${charge.customerEmail} failed: ${error instanceof Error ? error.message : error}`);
  }
});
console.log(failed ? `Done with ${failed} failures.` : 'Done.');
process.exitCode = failed ? 1 : 0;
