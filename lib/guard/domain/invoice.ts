// Deterministic invoice policy: the rules creating, sending and reminding of an invoice must pass
// before they may reach PayPal. Pure, like the refund policy. An invoice bills a customer, so only
// the task's customer may be billed, only if the shop already knows them, and only within the
// shop's invoice limits. Sending moves no money, but it reaches someone's inbox: only the
// invoice's own recipient, and at most one reminder per invoice per task.

import { exceeds, format, isMandateCustomer, type Decision, type Money, type TaskMandate, type Violation } from './policy';

// What the guard reads of a PayPal invoice. Several recipients, or none, never match one customer.
export type InvoiceFacts = {
  id: string;
  status: string;
  // The invoice total; null when PayPal gives none that can be read.
  amount: Money | null;
  recipientEmails: string[];
};

// Above `approvalThreshold` a clean invoice waits for a person; above `perInvoice` it is always blocked.
export type InvoiceLimits = { approvalThreshold: Money; perInvoice: Money; daily: Money };

// Sized like the refund limits for the seeded shop; not a setting yet.
export const DEFAULT_INVOICE_LIMITS: InvoiceLimits = {
  approvalThreshold: { minor: 10_000, currency: 'USD' },
  perInvoice: { minor: 50_000, currency: 'USD' },
  daily: { minor: 100_000, currency: 'USD' },
};

// A plain PayPal invoice id (e.g. INV2-Z56S-5LLA-Q52L-CPZ5), as the toolkit itself checks it. It is
// pasted into the request path, so a slash or dot could point the call at another PayPal resource.
export const INVOICE_ID = /^[A-Za-z0-9_-]{1,127}$/;

// What an invoice to be created bills, and whom.
export type InvoiceDraft = { recipientEmail: string; total: Money };

const CURRENCY = /^[A-Z]{3}$/;
const QUANTITY = /^\d+(\.\d+)?$/;
const AMOUNT = /^\d+(\.\d{1,2})?$/;

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

// A plain decimal as an integer and its number of decimals: "1.25" is 125 and 2.
function decimal(value: string): { units: bigint; places: number } {
  const [whole, fraction = ''] = value.split('.');
  return { units: BigInt(whole + fraction), places: fraction.length };
}

// What create_invoice bills: every line's quantity times its unit amount, plus shipping, in exact
// integer arithmetic. A taxed item is refused, as tax would bill more than that; discounts only
// lower it and are left out. A total with a fraction of a cent is rounded up, so the limits never
// see less than PayPal may bill.
export function parseInvoiceDraft(args: Record<string, unknown>): { draft: InvoiceDraft } | { invalid: string } {
  const recipients = args.primary_recipients;
  const billing = Array.isArray(recipients) && recipients.length === 1 && isRecord(recipients[0]) ? recipients[0].billing_info : undefined;
  const email = isRecord(billing) ? billing.email_address : undefined;
  if (typeof email !== 'string' || !email.trim()) return { invalid: 'create_invoice needs exactly one primary recipient with a billing_info.email_address' };

  const currency = args.currency_code;
  if (typeof currency !== 'string' || !CURRENCY.test(currency)) return { invalid: 'create_invoice needs a three-letter currency_code' };

  const items = args.items;
  if (!Array.isArray(items) || items.length === 0) return { invalid: 'create_invoice needs at least one item' };
  // Each line in minor units times 10^places; summed at the largest number of places.
  const lines: { units: bigint; places: number }[] = [];
  for (const [i, item] of items.entries()) {
    const unit = isRecord(item) ? item.unit_amount : undefined;
    if (!isRecord(item) || typeof item.quantity !== 'string' || !QUANTITY.test(item.quantity) || decimal(item.quantity).units === BigInt(0)) {
      return { invalid: `items[${i}].quantity must be a positive decimal` };
    }
    if (!isRecord(unit) || typeof unit.value !== 'string' || !AMOUNT.test(unit.value)) {
      return { invalid: `items[${i}].unit_amount.value must be a non-negative amount with at most 2 decimals` };
    }
    if (unit.currency_code !== currency) return { invalid: `items[${i}].unit_amount must be in the invoice currency ${currency}` };
    if (item.tax !== undefined) return { invalid: `items[${i}] can't carry tax: the guard checks the invoice total without it` };
    const quantity = decimal(item.quantity);
    const unitMinor = decimal(unit.value).units * BigInt(10) ** BigInt(2 - decimal(unit.value).places);
    lines.push({ units: quantity.units * unitMinor, places: quantity.places });
  }

  const shipping = args.shipping_cost;
  if (shipping !== undefined) {
    if (typeof shipping !== 'string' || !AMOUNT.test(shipping)) return { invalid: 'shipping_cost must be a non-negative amount with at most 2 decimals' };
    lines.push({ units: decimal(shipping).units * BigInt(10) ** BigInt(2 - decimal(shipping).places), places: 0 });
  }

  const places = Math.max(...lines.map((line) => line.places));
  const scale = BigInt(10) ** BigInt(places);
  const sum = lines.reduce((total, line) => total + line.units * BigInt(10) ** BigInt(places - line.places), BigInt(0));
  const minor = (sum + scale - BigInt(1)) / scale;
  if (minor > BigInt(Number.MAX_SAFE_INTEGER)) return { invalid: 'create_invoice total is too large' };
  if (minor === BigInt(0)) return { invalid: 'create_invoice bills nothing: its total must be over 0' };
  return { draft: { recipientEmail: email, total: { minor: Number(minor), currency } } };
}

export type InvoiceCreationContext = {
  draft: InvoiceDraft;
  mandate: TaskMandate;
  // Whether the task customer is one the shop already has.
  known: boolean;
  limits: InvoiceLimits;
  billedToday: Money;
};

export function evaluateInvoiceCreation({ draft, mandate, known, limits, billedToday }: InvoiceCreationContext): Decision {
  const violations: Violation[] = [];
  const { total } = draft;
  if (!isMandateCustomer(draft.recipientEmail, mandate)) {
    violations.push({ code: 'CUSTOMER_MISMATCH', message: `Invoice recipient is not the task customer ${mandate.customerEmail}` });
  }
  if (!known) {
    violations.push({ code: 'UNKNOWN_CUSTOMER', message: `${mandate.customerEmail} is not an existing customer of the shop` });
  }
  if (exceeds(total, limits.perInvoice)) {
    violations.push({ code: 'INVOICE_LIMIT', message: `Invoice ${format(total)} is over the per-invoice limit ${format(limits.perInvoice)}` });
  }
  const dayTotal: Money = { minor: billedToday.minor + total.minor, currency: total.currency };
  if (billedToday.currency !== total.currency || exceeds(dayTotal, limits.daily)) {
    violations.push({ code: 'DAILY_LIMIT', message: `Invoices today would reach ${format(dayTotal)}, over ${format(limits.daily)}` });
  }
  // A blocked invoice never waits for a person, so the approval threshold isn't a reason then.
  if (violations.length) return { verdict: 'block', violations };
  if (exceeds(total, limits.approvalThreshold)) {
    return {
      verdict: 'hold',
      violations: [{ code: 'APPROVAL_REQUIRED', message: `Invoice ${format(total)} is over the approval threshold ${format(limits.approvalThreshold)}` }],
    };
  }
  return { verdict: 'allow', violations: [] };
}

// send_invoice and send_invoice_reminder: a plain id, and no one but the invoice's own recipient.
// The toolkit's additional_recipients would mail the invoice to any address the agent names.
export function parseInvoiceSending(tool: string, args: Record<string, unknown>): { invoiceId: string } | { invalid: string } {
  if (typeof args.invoice_id !== 'string' || !INVOICE_ID.test(args.invoice_id)) return { invalid: `${tool} needs a plain invoice_id` };
  const extra = args.additional_recipients;
  if (extra !== undefined && !(Array.isArray(extra) && extra.length === 0)) {
    return { invalid: `${tool} may send only to the invoice's own recipient: additional_recipients must be empty` };
  }
  if (args.send_to_recipient === false) return { invalid: `${tool} may send only to the invoice's own recipient: send_to_recipient cannot be false` };
  return { invoiceId: args.invoice_id };
}

// PayPal sends only a draft; a reminder only makes sense while the invoice is still owed.
const SENDABLE = new Set(['DRAFT']);
const REMINDABLE = new Set(['SENT', 'UNPAID', 'PARTIALLY_PAID']);

// One per invoice per task: a customer is reminded once, not flooded.
const MAX_REMINDERS_PER_INVOICE = 1;

export type InvoiceSendingContext = {
  invoice: InvoiceFacts;
  mandate: TaskMandate;
  reminder: boolean;
  // Reminders of this invoice this task already sent or parked for a person.
  remindersThisTask: number;
};

export function evaluateInvoiceSending({ invoice, mandate, reminder, remindersThisTask }: InvoiceSendingContext): Decision {
  const violations: Violation[] = [];
  if (invoice.recipientEmails.length !== 1 || !isMandateCustomer(invoice.recipientEmails[0], mandate)) {
    violations.push({ code: 'CUSTOMER_MISMATCH', message: `Invoice ${invoice.id} is not billed to the task customer ${mandate.customerEmail} alone` });
  }
  const status = invoice.status || 'unknown';
  if (!reminder && !SENDABLE.has(invoice.status)) {
    violations.push({ code: 'INVOICE_NOT_SENDABLE', message: `Invoice status is ${status}; only a DRAFT invoice can be sent` });
  }
  if (reminder && !REMINDABLE.has(invoice.status)) {
    violations.push({ code: 'INVOICE_NOT_SENDABLE', message: `Invoice status is ${status}; only a SENT, UNPAID or PARTIALLY_PAID invoice can be reminded of` });
  }
  if (reminder && remindersThisTask >= MAX_REMINDERS_PER_INVOICE) {
    violations.push({ code: 'REMINDER_LIMIT', message: `A task may send at most ${MAX_REMINDERS_PER_INVOICE} reminder for invoice ${invoice.id}` });
  }
  return violations.length ? { verdict: 'block', violations } : { verdict: 'allow', violations: [] };
}
