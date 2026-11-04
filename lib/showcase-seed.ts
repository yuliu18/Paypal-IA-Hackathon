// Showcase data for the dashboard: a shop's last months in the PayPal sandbox, with many customers,
// every catalogue product, and invoices paid, partly paid, overdue or still open, so its charts have
// something to show. `npm run seed:showcase` creates it; every run adds a new batch. Sandbox only:
// the money is fictitious and no buyer has to approve anything (payments on invoices are recorded
// by the shop, and the card charges use PayPal's sandbox test card).

import { SHOP_CATALOGUE } from './shop/catalogue.ts';

export type ShowcaseCustomer = { givenName: string; surname: string; email: string; company?: string; country: string };

// Fictitious customers on reserved example domains: individuals and small businesses, each with
// how often they buy.
export const SHOWCASE_CUSTOMERS: (ShowcaseCustomer & { weight: number })[] = [
  { givenName: 'Lucía', surname: 'Martín', email: 'lucia.martin@example.com', country: 'ES', weight: 3 },
  { givenName: 'Tom', surname: 'Becker', email: 'tom.becker@example.org', country: 'DE', weight: 2 },
  { givenName: 'Aiko', surname: 'Tanaka', email: 'aiko.tanaka@example.net', country: 'JP', weight: 1 },
  { givenName: 'Marie', surname: 'Dubois', email: 'marie.dubois@example.com', country: 'FR', weight: 2 },
  { givenName: 'Sam', surname: 'Okafor', email: 'sam.okafor@example.org', country: 'GB', weight: 1 },
  { givenName: 'Wei', surname: 'Chen', email: 'wei.chen@example.net', country: 'US', weight: 2 },
  { givenName: 'Priya', surname: 'Shah', email: 'priya.shah@example.com', country: 'US', weight: 1 },
  { givenName: 'Javier', surname: 'Ruiz', email: 'compras@casaruiz.example', company: 'Casa Ruiz Restaurante', country: 'ES', weight: 5 },
  { givenName: 'Nora', surname: 'Lindqvist', email: 'orders@nordichome.example', company: 'Nordic Home AB', country: 'SE', weight: 4 },
  { givenName: 'Giulia', surname: 'Rossi', email: 'giulia@trattoriarossi.example', company: 'Trattoria Rossi', country: 'IT', weight: 4 },
  { givenName: 'Ben', surname: 'Carter', email: 'purchasing@brewlab.example', company: 'BrewLab Coffee', country: 'US', weight: 5 },
  { givenName: 'Emma', surname: 'Walsh', email: 'emma@thelinenroom.example', company: 'The Linen Room', country: 'IE', weight: 3 },
  { givenName: 'Kenji', surname: 'Mori', email: 'kenji@morigallery.example', company: 'Mori Gallery Café', country: 'JP', weight: 2 },
  { givenName: 'Olivia', surname: 'Grant', email: 'events@grantcatering.example', company: 'Grant Catering Ltd', country: 'GB', weight: 3 },
];

// Catalogue products the shop also lists in PayPal's catalog, and two plans for its subscription box.
export const SHOWCASE_PRODUCTS = [
  { name: 'Ceramic mug set', description: 'Four hand-glazed stoneware mugs', type: 'PHYSICAL' },
  { name: 'Linen tablecloth', description: 'Washed linen, 160 x 250 cm', type: 'PHYSICAL' },
  { name: 'Oak serving board', description: 'Solid oak, oiled', type: 'PHYSICAL' },
  { name: 'Table setting workshop', description: 'Two-hour styling session for restaurants', type: 'SERVICE' },
] as const;

export const SHOWCASE_PLANS = [
  { name: 'Tableware box monthly', unit: 'MONTH', price: '29.00' },
  { name: 'Tableware box yearly', unit: 'YEAR', price: '290.00' },
] as const;

export type Outcome = 'paid' | 'partial' | 'overdue' | 'open' | 'draft' | 'cancelled';
const METHODS = ['BANK_TRANSFER', 'PAYPAL', 'CREDIT_CARD', 'CHECK', 'CASH', 'WIRE_TRANSFER'] as const;

export type PlannedItem = { name: string; quantity: number; unitValue: string; discountPercent?: number; taxPercent?: number };
export type PlannedInvoice = {
  customer: ShowcaseCustomer;
  invoiceDate: string;
  dueDate: string;
  items: PlannedItem[];
  outcome: Outcome;
  // For a paid or partly paid invoice: when it was paid and how; a part paid is `share` of the total.
  payment?: { date: string; method: (typeof METHODS)[number]; share: number };
};
export type PlannedCharge = { customerEmail: string; product: string; value: string };
export type ShowcasePlan = { invoices: PlannedInvoice[]; charges: PlannedCharge[] };

// VAT on business customers in the EU; none for individuals or customers elsewhere.
const EU_VAT: Record<string, number> = { ES: 21, DE: 19, FR: 20, IT: 22, SE: 25, IE: 23 };

const DAY = 86_400_000;
const isoDay = (ms: number) => new Date(ms).toISOString().slice(0, 10);

// A small deterministic generator, so a test can pin a plan and a run is easy to reason about.
export function seededRandom(seed: number): () => number {
  // Mixed first, so a small seed doesn't start the sequence with small numbers.
  let state = Math.imul((seed ^ 0x9e3779b9) >>> 0, 0x85ebca6b) >>> 0 || 1;
  const next = () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return (state >>> 0) / 4_294_967_296;
  };
  for (let i = 0; i < 8; i++) next();
  return next;
}

function pick<T>(random: () => number, items: readonly T[], weight: (item: T) => number = () => 1): T {
  const total = items.reduce((sum, item) => sum + weight(item), 0);
  let left = random() * total;
  for (const item of items) {
    left -= weight(item);
    if (left < 0) return item;
  }
  return items[items.length - 1];
}

// The outcome follows the invoice's age: old invoices are mostly paid, recent ones mostly open.
function outcomeFor(random: () => number, ageDays: number, termDays: number): Outcome {
  const roll = random();
  if (roll < 0.04) return 'cancelled';
  if (ageDays < 3 && roll < 0.3) return 'draft';
  if (ageDays <= termDays) return roll < 0.45 ? 'paid' : roll < 0.55 ? 'partial' : 'open';
  return roll < 0.72 ? 'paid' : roll < 0.82 ? 'partial' : 'overdue';
}

// `count` invoices spread over the `months` before `today`, busier towards today, and `charges` card
// payments made today (PayPal dates a card charge when it runs, so they can't be spread out).
export function showcasePlan({ today, random, count = 60, months = 6, charges = 16 }: { today: Date; random: () => number; count?: number; months?: number; charges?: number }): ShowcasePlan {
  const end = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
  const span = Math.round(months * 30.4) * DAY;
  const products = SHOP_CATALOGUE.items;

  const invoices = Array.from({ length: count }, (): PlannedInvoice => {
    // sqrt skews the dates towards today: a growing shop.
    const issued = end - Math.floor((1 - Math.sqrt(random())) * span / DAY) * DAY;
    const customer = pick(random, SHOWCASE_CUSTOMERS, (c) => c.weight);
    const business = Boolean(customer.company);
    const termDays = business ? pick(random, [15, 30, 30, 45]) : pick(random, [7, 15]);
    const vat = business ? EU_VAT[customer.country] : undefined;
    const lines = 1 + Math.floor(random() * (business ? 4 : 2));
    const items = [...products]
      .sort(() => random() - 0.5)
      .slice(0, lines)
      .map((product): PlannedItem => ({
        name: product.name,
        quantity: business ? 2 + Math.floor(random() * 11) : 1 + Math.floor(random() * 2),
        unitValue: (product.priceMinor / 100).toFixed(2),
        ...(business && random() < 0.3 && { discountPercent: pick(random, [5, 10, 15]) }),
        ...(vat !== undefined && { taxPercent: vat }),
      }));
    const ageDays = Math.round((end - issued) / DAY);
    const outcome = outcomeFor(random, ageDays, termDays);
    const planned: PlannedInvoice = { customer, invoiceDate: isoDay(issued), dueDate: isoDay(issued + termDays * DAY), items, outcome };
    if (outcome === 'paid' || outcome === 'partial') {
      // Most pay within the term, some late; never after today.
      const late = random() < 0.25 ? Math.floor(random() * 20) : 0;
      const paidAfter = Math.min(Math.floor(random() * termDays) + late, ageDays);
      planned.payment = {
        date: isoDay(issued + paidAfter * DAY),
        method: pick(random, METHODS, (m) => (m === 'BANK_TRANSFER' || m === 'PAYPAL' ? 3 : 1)),
        share: outcome === 'paid' ? 1 : pick(random, [0.25, 0.4, 0.5]),
      };
    }
    return planned;
  });

  const individuals = SHOWCASE_CUSTOMERS.filter((c) => !c.company);
  const cardCharges = Array.from({ length: charges }, (): PlannedCharge => {
    const product = pick(random, products);
    return { customerEmail: pick(random, individuals).email, product: product.name, value: (product.priceMinor / 100).toFixed(2) };
  });

  return { invoices: invoices.sort((a, b) => a.invoiceDate.localeCompare(b.invoiceDate)), charges: cardCharges };
}

// The PayPal v2 invoice for a planned one. The shop is the invoicer PayPal already knows (its own
// account), so only the recipient, dates and lines are set; PayPal numbers it.
export function invoiceBody(invoice: PlannedInvoice, currency = 'USD') {
  const { customer } = invoice;
  return {
    detail: {
      currency_code: currency,
      invoice_date: invoice.invoiceDate,
      payment_term: { due_date: invoice.dueDate },
      note: 'Thank you for your order.',
    },
    primary_recipients: [
      {
        billing_info: {
          name: { given_name: customer.givenName, surname: customer.surname },
          email_address: customer.email,
          ...(customer.company && { business_name: customer.company }),
        },
      },
    ],
    items: invoice.items.map((item) => ({
      name: item.name,
      quantity: String(item.quantity),
      unit_amount: { currency_code: currency, value: item.unitValue },
      unit_of_measure: 'QUANTITY',
      ...(item.discountPercent && { discount: { percent: String(item.discountPercent) } }),
      ...(item.taxPercent && { tax: { name: 'VAT', percent: String(item.taxPercent) } }),
    })),
    configuration: { allow_partial_payment: invoice.outcome === 'partial' },
  };
}
