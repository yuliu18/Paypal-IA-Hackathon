// Deterministic order policy: the rules a sales agent's create_order must pass before it may reach
// PayPal. Pure, like the refund and invoice policies. An order asks the customer to pay, so it may
// carry only catalogue products at their catalogue price, within the shop's quantity and discount
// limits, and may send the buyer back only to the shop's own pages: a fooled agent could otherwise
// sell at any price, or send the buyer from PayPal to a page that asks them to pay again.

import type { ShopCatalogue } from '../../shop/catalogue';
import { findCatalogueItem } from '../../shop/catalogue';
import { format, type Decision, type Violation } from './policy';

// A plain PayPal order id, as the toolkit's get_order checks it. The binder pastes it into the
// request path, so nothing else may reach it.
export const ORDER_ID = /^[A-Z0-9]{17,32}$/;

// The audit detail of a create_order the guard executed and bound to the task customer. The shop's
// capture looks for it, so it captures only orders the guard itself created for that customer.
export const boundOrderDetail = (orderId: string) => `Order ${orderId} bound to the task customer`;

// One line of create_order, in exact minor units. `taxBasisPoints` is taxPercent x 100.
export type OrderLine = { name: string; quantity: number; itemCostMinor: number; taxBasisPoints: number; itemTotalMinor: number };

// What create_order asks PayPal for. The total is computed as the toolkit computes it (items plus
// tax plus shipping minus the discount), each tax rounded up so the limits never see less than
// PayPal may charge.
export type OrderDraft = {
  currency: string;
  lines: OrderLine[];
  subtotalMinor: number;
  taxMinor: number;
  discountMinor: number;
  shippingMinor: number;
  totalMinor: number;
  returnUrl?: string;
  cancelUrl?: string;
};

const CURRENCY = /^[A-Z]{3}$/;
// The toolkit sends JSON numbers; one that prints as anything but a plain amount (NaN, 1e-7,
// 0.30000000000000004) isn't one.
const AMOUNT = /^\d+(\.\d{1,2})?$/;
// PayPal's limit on an item name.
const MAX_NAME = 127;

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

// A non-negative JSON number with at most 2 decimals, times 100, exactly.
function hundredths(value: unknown): bigint | undefined {
  if (typeof value !== 'number') return undefined;
  const text = String(value);
  if (!AMOUNT.test(text)) return undefined;
  const [whole, fraction = ''] = text.split('.');
  return BigInt(whole + fraction.padEnd(2, '0'));
}

const SAFE = BigInt(Number.MAX_SAFE_INTEGER);
const ZERO = BigInt(0);
const HUNDRED = BigInt(100);

// The toolkit's zod defaults apply to a missing value only: a JSON null is not a number to it, so
// it rejects the call. The guard rejects it the same way, before it counts the conversation's order.
const orDefault = (value: unknown, fallback: number) => (value === undefined ? fallback : value);

// create_order's arguments as the toolkit 1.11 reads them, with its defaults: quantity 1,
// taxPercent 0, discount 0, shippingCost 0. returnUrl and cancelUrl are kept as given; the toolkit
// fills missing ones with example.com pages, which the policy refuses.
export function parseOrderDraft(args: Record<string, unknown>): { draft: OrderDraft } | { invalid: string } {
  const currency = args.currencyCode;
  if (typeof currency !== 'string' || !CURRENCY.test(currency)) return { invalid: 'create_order needs a three-letter currencyCode' };

  const items = args.items;
  if (!Array.isArray(items) || items.length === 0 || items.length > 50) return { invalid: 'create_order needs 1 to 50 items' };
  const lines: OrderLine[] = [];
  let subtotal = ZERO;
  let tax = ZERO;
  for (const [i, item] of items.entries()) {
    if (!isRecord(item) || typeof item.name !== 'string' || !item.name.trim() || item.name.length > MAX_NAME) {
      return { invalid: `items[${i}].name must be 1 to ${MAX_NAME} characters` };
    }
    const quantity = orDefault(item.quantity, 1);
    if (typeof quantity !== 'number' || !Number.isSafeInteger(quantity) || quantity < 1) return { invalid: `items[${i}].quantity must be a whole number over 0` };
    const cost = hundredths(item.itemCost);
    const total = hundredths(item.itemTotal);
    const taxBasisPoints = hundredths(orDefault(item.taxPercent, 0));
    if (cost === undefined) return { invalid: `items[${i}].itemCost must be a non-negative amount with at most 2 decimals` };
    if (total === undefined) return { invalid: `items[${i}].itemTotal must be a non-negative amount with at most 2 decimals` };
    if (taxBasisPoints === undefined) return { invalid: `items[${i}].taxPercent must be a non-negative number with at most 2 decimals` };
    const line = cost * BigInt(quantity);
    subtotal += line;
    // Rounded up: cost x quantity x percent / 100, in hundredths of a percent.
    tax += (line * taxBasisPoints + BigInt(9999)) / BigInt(10000);
    if (cost > SAFE || total > SAFE) return { invalid: `items[${i}] amounts are too large` };
    lines.push({ name: item.name, quantity, itemCostMinor: Number(cost), taxBasisPoints: Number(taxBasisPoints), itemTotalMinor: Number(total) });
  }

  const discount = hundredths(orDefault(args.discount, 0));
  if (discount === undefined) return { invalid: 'discount must be a non-negative amount with at most 2 decimals' };
  const shipping = hundredths(orDefault(args.shippingCost, 0));
  if (shipping === undefined) return { invalid: 'shippingCost must be a non-negative amount with at most 2 decimals' };

  const total = subtotal + tax + shipping - discount;
  if (total <= ZERO) return { invalid: 'create_order charges nothing: the discount must be less than what the order costs' };
  if (subtotal > SAFE || total > SAFE || discount > SAFE || shipping > SAFE) return { invalid: 'create_order total is too large' };

  for (const key of ['returnUrl', 'cancelUrl'] as const) {
    if (args[key] !== undefined && typeof args[key] !== 'string') return { invalid: `${key} must be a URL` };
  }
  return {
    draft: {
      currency,
      lines,
      subtotalMinor: Number(subtotal),
      taxMinor: Number(tax),
      discountMinor: Number(discount),
      shippingMinor: Number(shipping),
      totalMinor: Number(total),
      ...(typeof args.returnUrl === 'string' && { returnUrl: args.returnUrl }),
      ...(typeof args.cancelUrl === 'string' && { cancelUrl: args.cancelUrl }),
    },
  };
}

export type OrderCreationContext = {
  draft: OrderDraft;
  catalogue: ShopCatalogue;
  // The shop's own origin (e.g. https://shop.example): the only place PayPal may send the buyer back to.
  shopOrigin: string;
  // Orders this task already created or parked for a person.
  ordersThisTask: number;
  // Null when a person approved the order: approval lifts the threshold and nothing else.
  approvalThresholdMinor: number | null;
};

function originOf(url: string | undefined): string | undefined {
  if (!url || !URL.canParse(url)) return undefined;
  return new URL(url).origin;
}

export function evaluateOrderCreation({ draft, catalogue, shopOrigin, ordersThisTask, approvalThresholdMinor }: OrderCreationContext): Decision {
  const violations: Violation[] = [];
  const money = (minor: number) => format({ minor, currency: draft.currency });

  if (ordersThisTask >= catalogue.maxOrdersPerTask) {
    violations.push({ code: 'ORDER_LIMIT', message: `A conversation may create at most ${catalogue.maxOrdersPerTask} order` });
  }
  if (draft.currency !== catalogue.currency) {
    violations.push({ code: 'CURRENCY_MISMATCH', message: `Order in ${draft.currency}, the shop sells in ${catalogue.currency}` });
  }

  // Units by catalogue product, across lines, so splitting a product over lines can't pass the maximum.
  const units = new Map<string, number>();
  for (const line of draft.lines) {
    const item = findCatalogueItem(catalogue, line.name);
    if (!item) {
      violations.push({ code: 'NOT_IN_CATALOGUE', message: `${line.name} is not in the shop catalogue` });
    } else {
      units.set(item.name, (units.get(item.name) ?? 0) + line.quantity);
      if (line.itemCostMinor !== item.priceMinor) {
        violations.push({ code: 'PRICE_MISMATCH', message: `${item.name} costs ${money(item.priceMinor)} in the catalogue, not ${money(line.itemCostMinor)}` });
      }
    }
    if (line.taxBasisPoints !== catalogue.taxPercent * 100) {
      violations.push({ code: 'TAX_MISMATCH', message: `${line.name}: tax is ${catalogue.taxPercent} % in the catalogue, not ${line.taxBasisPoints / 100} %` });
    }
    // The toolkit ignores itemTotal and charges itemCost x quantity; a different itemTotal would
    // make the order read as cheaper than it is.
    if (BigInt(line.itemTotalMinor) !== BigInt(line.itemCostMinor) * BigInt(line.quantity)) {
      violations.push({ code: 'ORDER_INVALID', message: `${line.name}: itemTotal ${money(line.itemTotalMinor)} is not ${line.quantity} x ${money(line.itemCostMinor)}` });
    }
  }
  for (const [name, quantity] of units) {
    if (quantity > catalogue.maxQuantityPerItem) {
      violations.push({ code: 'QUANTITY_LIMIT', message: `${name}: ${quantity} ordered, at most ${catalogue.maxQuantityPerItem} per order` });
    }
  }

  // discount <= subtotal x percent / 100, compared without dividing.
  if (BigInt(draft.discountMinor) * HUNDRED > BigInt(draft.subtotalMinor) * BigInt(catalogue.maxDiscountPercent)) {
    const allowed = (BigInt(draft.subtotalMinor) * BigInt(catalogue.maxDiscountPercent)) / HUNDRED;
    violations.push({
      code: 'DISCOUNT_LIMIT',
      message: `Discount ${money(draft.discountMinor)} is over ${catalogue.maxDiscountPercent} % of the items, at most ${money(Number(allowed))}`,
    });
  }
  if (draft.shippingMinor !== catalogue.shippingMinor) {
    violations.push({ code: 'SHIPPING_MISMATCH', message: `Shipping is ${money(catalogue.shippingMinor)} in the catalogue, not ${money(draft.shippingMinor)}` });
  }

  // A missing link is refused too: the toolkit would fill in an example.com page.
  const shop = originOf(shopOrigin);
  for (const key of ['returnUrl', 'cancelUrl'] as const) {
    if (!shop || originOf(draft[key]) !== shop) {
      violations.push({ code: 'RETURN_URL_NOT_SHOP', message: `${key} must be a page of the shop ${shop ?? '(no shop origin configured)'}` });
    }
  }

  // A blocked order never waits for a person, so the approval threshold isn't a reason then.
  if (violations.length) return { verdict: 'block', violations };
  if (approvalThresholdMinor !== null && draft.totalMinor > approvalThresholdMinor) {
    return {
      verdict: 'hold',
      violations: [{ code: 'APPROVAL_REQUIRED', message: `Order ${money(draft.totalMinor)} is over the approval threshold ${money(approvalThresholdMinor)}` }],
    };
  }
  return { verdict: 'allow', violations: [] };
}
