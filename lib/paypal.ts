// PayPal REST client: every call this demo makes to PayPal goes through here. It covers
// catalog products, billing plans, invoicing, Transaction Search, balances and the order and
// capture lookups the payment guard needs and the sandbox card charges the demo seed makes, with plain fetch and no SDK. Server-side only: it reads the client secret from the shop's settings or the environment.

import { loadSettings } from './settings/settings.ts';

const BASE_URL = 'https://api-m.sandbox.paypal.com';
const MAX_ATTEMPTS = 4;

export class PayPalApiError extends Error {
  constructor(
    readonly status: number,
    readonly path: string,
    body: string,
  ) {
    super(`PayPal ${status} on ${path}: ${body.slice(0, 300)}`);
    this.name = 'PayPalApiError';
  }
}

// The token is kept for the credentials it was minted with, so saving new ones on /settings
// takes effect on the next call.
let cachedToken: { value: string; expiresAt: number; credentials: string } | undefined;

export async function accessToken(): Promise<string> {
  const { clientId: id, secret } = (await loadSettings()).paypal;
  if (!id || !secret) throw new Error('Set the PayPal client ID and secret on /settings, or PAYPAL_CLIENT_ID and PAYPAL_SECRET in .env.local');
  const credentials = `${id}:${secret}`;
  if (cachedToken && cachedToken.credentials === credentials && Date.now() < cachedToken.expiresAt) return cachedToken.value;

  const res = await fetch(`${BASE_URL}/v1/oauth2/token`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${Buffer.from(credentials).toString('base64')}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials',
    cache: 'no-store',
  });
  if (!res.ok) throw new PayPalApiError(res.status, '/v1/oauth2/token', await res.text());

  const { access_token, expires_in } = (await res.json()) as { access_token: string; expires_in: number };
  // Refresh a minute early so an in-flight request never carries an expired token.
  cachedToken = { value: access_token, expiresAt: Date.now() + (expires_in - 60) * 1000, credentials };
  return access_token;
}

async function get<T>(path: string): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    const res = await fetch(`${BASE_URL}${path}`, {
      headers: { Authorization: `Bearer ${await accessToken()}` },
      cache: 'no-store',
    });
    if (res.ok) return (await res.json()) as T;

    // A revoked or expired token: drop it and mint a new one once.
    if (res.status === 401 && attempt === 1) {
      cachedToken = undefined;
      continue;
    }
    if ((res.status === 429 || res.status >= 500) && attempt < MAX_ATTEMPTS) {
      await new Promise((resolve) => setTimeout(resolve, 2 ** attempt * 250));
      continue;
    }
    throw new PayPalApiError(res.status, path, await res.text());
  }
}

// `path` must already carry whatever flag makes the endpoint report `total_pages`.
async function listAll<T>(path: string, key: string, pageSize: number): Promise<T[]> {
  const items: T[] = [];
  const sep = path.includes('?') ? '&' : '?';
  for (let page = 1; ; page++) {
    const res = await get<{ total_pages?: number } & Record<string, unknown>>(
      `${path}${sep}page_size=${pageSize}&page=${page}`,
    );
    items.push(...((res[key] as T[] | undefined) ?? []));
    if (page >= (res.total_pages ?? 1)) return items;
  }
}

export type Money = { value: string; currency_code: string };

// PayPal sends amounts as decimal strings; missing amounts count as 0.
export const amountOf = (m?: Money | null) => (m?.value === undefined ? 0 : Number(m.value));

// --- Catalog products & billing plans ------------------------------------------

export type Product = {
  id: string;
  name: string;
  description?: string;
  type?: 'PHYSICAL' | 'DIGITAL' | 'SERVICE';
  category?: string;
  create_time: string;
};

export type IntervalUnit = 'DAY' | 'WEEK' | 'MONTH' | 'YEAR';

export type BillingCycle = {
  frequency: { interval_unit: IntervalUnit; interval_count: number };
  tenure_type: 'REGULAR' | 'TRIAL';
  sequence: number;
  total_cycles: number;
  pricing_scheme?: { fixed_price?: Money };
};

export type Plan = {
  id: string;
  product_id: string;
  name: string;
  status: 'CREATED' | 'INACTIVE' | 'ACTIVE';
  create_time: string;
  billing_cycles: BillingCycle[];
  payment_preferences?: { setup_fee?: Money };
};

// The list endpoints return summaries (no product type/category, no billing cycles),
// so each record is fetched in full.
export async function listProducts(): Promise<Product[]> {
  const summaries = await listAll<{ id: string }>('/v1/catalogs/products?total_required=true', 'products', 20);
  return Promise.all(summaries.map((p) => get<Product>(`/v1/catalogs/products/${encodeURIComponent(p.id)}`)));
}

export async function listPlans(): Promise<Plan[]> {
  const summaries = await listAll<{ id: string }>('/v1/billing/plans?total_required=true', 'plans', 20);
  return Promise.all(summaries.map((p) => get<Plan>(`/v1/billing/plans/${encodeURIComponent(p.id)}`)));
}

// --- Invoicing -------------------------------------------------------------------

export type InvoiceStatus =
  | 'DRAFT'
  | 'SENT'
  | 'SCHEDULED'
  | 'UNPAID'
  | 'PAYMENT_PENDING'
  | 'PAID'
  | 'MARKED_AS_PAID'
  | 'PARTIALLY_PAID'
  | 'REFUNDED'
  | 'PARTIALLY_REFUNDED'
  | 'MARKED_AS_REFUNDED'
  | 'CANCELLED';

export type Invoice = {
  id: string;
  status: InvoiceStatus;
  detail: {
    invoice_number: string;
    currency_code: string;
    invoice_date?: string;
    payment_term?: { term_type?: string; due_date?: string };
  };
  primary_recipients?: {
    billing_info?: {
      name?: { full_name?: string };
      business_name?: string;
      email_address?: string;
    };
  }[];
  items?: {
    id?: string;
    name: string;
    quantity: string;
    unit_amount: Money;
    unit_of_measure?: string;
    tax?: { percent?: string; amount?: Money };
    discount?: { percent?: string; amount?: Money };
  }[];
  amount?: Money & { breakdown?: { tax_total?: Money; shipping?: { amount?: Money } } };
  due_amount?: Money;
  payments?: {
    paid_amount?: Money;
    transactions?: { payment_id?: string; payment_date?: string; method?: string; amount: Money }[];
  };
  refunds?: {
    refund_amount?: Money;
    transactions?: { recipient_transaction_id?: string; refund_date?: string; method?: string; amount: Money }[];
  };
};

// The list omits line items, payments and refunds; the detail endpoint has them.
export async function listInvoices(): Promise<Invoice[]> {
  const summaries = await listAll<{ id: string }>('/v2/invoicing/invoices?total_required=true', 'items', 100);
  return Promise.all(summaries.map((i) => get<Invoice>(`/v2/invoicing/invoices/${encodeURIComponent(i.id)}`)));
}

// --- Transaction Search & balances -------------------------------------------------

export type Transaction = {
  transaction_info: {
    transaction_id: string;
    paypal_reference_id?: string;
    transaction_event_code?: string;
    transaction_initiation_date?: string;
    transaction_amount?: Money;
    fee_amount?: Money;
    transaction_status?: string;
    ending_balance?: Money;
    transaction_subject?: string;
    transaction_note?: string;
    custom_field?: string;
  };
  payer_info?: { email_address?: string };
};

// Transaction Search allows ranges of at most 31 days and rejects fractional seconds.
export const TRANSACTION_SEARCH_MAX_DAYS = 31;

export function searchTransactions(start: Date, end: Date): Promise<Transaction[]> {
  const iso = (d: Date) => `${d.toISOString().slice(0, 19)}Z`;
  return listAll<Transaction>(
    `/v1/reporting/transactions?start_date=${iso(start)}&end_date=${iso(end)}&fields=all`,
    'transaction_details',
    500,
  );
}

export type Balances = {
  as_of_time?: string;
  balances?: { currency: string; total_balance?: Money; available_balance?: Money; withheld_balance?: Money }[];
};

export function getBalances(): Promise<Balances> {
  return get<Balances>('/v1/reporting/balances');
}

// --- Orders & captures (payment guard) ---------------------------------------

export type Refund = { id: string; status: string; amount?: Money };

export type Capture = {
  id: string;
  status: string;
  amount: Money;
  supplementary_data?: { related_ids?: { order_id?: string } };
};

export type Order = {
  id: string;
  status: string;
  payer?: { email_address?: string };
  purchase_units?: {
    custom_id?: string;
    payments?: { captures?: Capture[]; refunds?: Refund[] };
  }[];
};

export function getCapture(id: string): Promise<Capture> {
  return get<Capture>(`/v2/payments/captures/${encodeURIComponent(id)}`);
}

export function getOrder(id: string): Promise<Order> {
  return get<Order>(`/v2/checkout/orders/${encodeURIComponent(id)}`);
}

// --- Sandbox charges (demo seed) ------------------------------------------------

// PayPal's sandbox test Visa: a card order with intent CAPTURE is captured on creation, with no
// buyer approval step.
const SANDBOX_CARD = { number: '4111111111111111', expiry: '2030-12', security_code: '123', name: 'Sandbox Buyer' };

export type Charge = { orderId: string; captureId: string; status: string };

// Charges the sandbox test card, recording the shop's customer in custom_id the way a shop's
// server would. Not retried: a repeated POST could charge twice.
export async function chargeCard({ amount, customerEmail, description }: { amount: Money; customerEmail: string; description: string }): Promise<Charge> {
  const path = '/v2/checkout/orders';
  const res = await fetch(`${BASE_URL}${path}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${await accessToken()}`,
      'Content-Type': 'application/json',
      'PayPal-Request-Id': crypto.randomUUID(),
    },
    body: JSON.stringify({
      intent: 'CAPTURE',
      purchase_units: [{ amount, custom_id: customerEmail, description }],
      payment_source: { card: SANDBOX_CARD },
    }),
    cache: 'no-store',
  });
  if (!res.ok) throw new PayPalApiError(res.status, path, await res.text());

  const order = (await res.json()) as Order;
  const capture = order.purchase_units?.[0]?.payments?.captures?.[0];
  if (order.status !== 'COMPLETED' || !capture) throw new Error(`Order ${order.id} was not captured (${order.status})`);
  return { orderId: order.id, captureId: capture.id, status: capture.status };
}
