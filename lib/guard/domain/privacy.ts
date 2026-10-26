// Data minimization: what the agent (and the LLM provider behind it) may see of a PayPal order,
// subscription, dispute or invoice. An allowlist of the fields its write needs; anything else, wherever
// PayPal adds it, is withheld: card details, payer, payee and subscriber, names, addresses, the
// shop's custom_id, notes and links.

import { maskPersonalData } from './redact';

// 'text' is free text the shop wrote, kept with any email or card number in it masked.
type Shape = 'scalar' | 'text' | Shape[] | { [field: string]: Shape };

const MONEY: Shape = { currency_code: 'scalar', value: 'scalar' };
const CAPTURE: Shape = { id: 'scalar', status: 'scalar', amount: MONEY, final_capture: 'scalar', create_time: 'scalar', update_time: 'scalar' };
const REFUND: Shape = { id: 'scalar', status: 'scalar', amount: MONEY, create_time: 'scalar', update_time: 'scalar' };
const ORDER: Shape = {
  id: 'scalar',
  intent: 'scalar',
  status: 'scalar',
  create_time: 'scalar',
  update_time: 'scalar',
  purchase_units: [
    { reference_id: 'scalar', amount: MONEY, description: 'text', payments: { captures: [CAPTURE], refunds: [REFUND] } },
  ],
};
const SUBSCRIPTION: Shape = {
  id: 'scalar',
  status: 'scalar',
  plan_id: 'scalar',
  start_time: 'scalar',
  create_time: 'scalar',
  update_time: 'scalar',
  billing_info: { next_billing_time: 'scalar', last_payment: { amount: MONEY, time: 'scalar' } },
};

// A dispute without the customer's messages, evidence or the buyer and seller blocks: what the
// shop is asked to accept, for how much, and by when.
const DISPUTE: Shape = {
  dispute_id: 'scalar',
  status: 'scalar',
  reason: 'scalar',
  dispute_amount: MONEY,
  dispute_life_cycle_stage: 'scalar',
  dispute_channel: 'scalar',
  create_time: 'scalar',
  update_time: 'scalar',
  seller_response_due_date: 'scalar',
  disputed_transactions: [{ seller_transaction_id: 'scalar', transaction_status: 'scalar', gross_amount: MONEY, create_time: 'scalar' }],
};

// An invoice without the invoicer, the recipients or links: what is billed, for how much, what is
// still due and by when. Notes and item names are the shop's text, kept masked.
const INVOICE: Shape = {
  id: 'scalar',
  status: 'scalar',
  detail: { invoice_number: 'scalar', currency_code: 'scalar', invoice_date: 'scalar', note: 'text', payment_term: { due_date: 'scalar' } },
  items: [{ name: 'text', quantity: 'scalar', unit_amount: MONEY }],
  amount: MONEY,
  due_amount: MONEY,
  payments: { paid_amount: MONEY, transactions: [{ amount: MONEY, payment_date: 'scalar' }] },
  refunds: { refund_amount: MONEY, transactions: [{ amount: MONEY, refund_date: 'scalar' }] },
};

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

// The kept part of `value`, or undefined when its shape doesn't match, so the caller withholds it whole.
function keep(value: unknown, shape: Shape, path: string, withheld: string[]): unknown {
  if (shape === 'scalar') return ['string', 'number', 'boolean'].includes(typeof value) ? value : undefined;
  if (shape === 'text') return typeof value === 'string' ? maskPersonalData(value) : undefined;
  if (Array.isArray(shape)) {
    if (!Array.isArray(value)) return undefined;
    return value.flatMap((item, i) => {
      const kept = keep(item, shape[0], `${path}[${i}]`, withheld);
      if (kept === undefined) withheld.push(`${path}[${i}]`);
      return kept === undefined ? [] : [kept];
    });
  }
  if (!isRecord(value)) return undefined;
  const kept: Record<string, unknown> = {};
  for (const [field, child] of Object.entries(value)) {
    const childPath = path ? `${path}.${field}` : field;
    const result = Object.hasOwn(shape, field) ? keep(child, shape[field], childPath, withheld) : undefined;
    if (result === undefined) withheld.push(childPath);
    else kept[field] = result;
  }
  return kept;
}

export function minimizeOrder(order: unknown): { order: Record<string, unknown>; withheld: string[] } {
  const withheld: string[] = [];
  const kept = keep(order, ORDER, '', withheld);
  return { order: isRecord(kept) ? kept : {}, withheld };
}

export function minimizeSubscription(subscription: unknown): { subscription: Record<string, unknown>; withheld: string[] } {
  const withheld: string[] = [];
  const kept = keep(subscription, SUBSCRIPTION, '', withheld);
  return { subscription: isRecord(kept) ? kept : {}, withheld };
}

export function minimizeDispute(dispute: unknown): { dispute: Record<string, unknown>; withheld: string[] } {
  const withheld: string[] = [];
  const kept = keep(dispute, DISPUTE, '', withheld);
  return { dispute: isRecord(kept) ? kept : {}, withheld };
}

export function minimizeInvoice(invoice: unknown): { invoice: Record<string, unknown>; withheld: string[] } {
  const withheld: string[] = [];
  const kept = keep(invoice, INVOICE, '', withheld);
  return { invoice: isRecord(kept) ? kept : {}, withheld };
}

// How a read's black box entry records what was withheld, and how the dashboard counts it back.
const WITHHELD = 'Withheld from the agent: ';
export const withheldDetail = (paths: string[]) => (paths.length ? `${WITHHELD}${paths.join(', ')}` : undefined);
export const withheldCount = (detail: string | undefined) => (detail?.startsWith(WITHHELD) ? detail.slice(WITHHELD.length).split(', ').length : 0);
