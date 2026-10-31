// The shop's priced catalogue: what the sales agent may sell, and the payment guard's source of
// truth for prices. PayPal's own catalog products carry no price, so the guard can't ask PayPal
// what an item costs. Pure data, no I/O. Amounts are integer minor units (cents).

export type CatalogueItem = { name: string; priceMinor: number };

export type ShopCatalogue = {
  currency: string;
  items: readonly CatalogueItem[];
  // Units of one product a single order may carry, across all its lines.
  maxQuantityPerItem: number;
  // The largest discount an order may carry, as a percent of its item subtotal.
  maxDiscountPercent: number;
  // Tax rate every line must carry, in whole percent.
  taxPercent: number;
  // Flat shipping cost per order.
  shippingMinor: number;
  // Above this total a clean order waits for a person.
  approvalThresholdMinor: number;
  // Orders one conversation (one agent task) may create.
  maxOrdersPerTask: number;
};

// Assumed defaults for the demo shop, not set by the shop owner yet: the three products of the
// sample payments (lib/demo-seed.ts) plus a few more, USD, at most 5 of a product per order, a
// discount of at most 10 % of the items, no tax, free shipping (so an agent can't add a shipping
// charge), orders over 300.00 USD held for a person, and one order per conversation.
export const SHOP_CATALOGUE: ShopCatalogue = {
  currency: 'USD',
  items: [
    { name: 'Ceramic mug set', priceMinor: 4999 },
    { name: 'Linen tablecloth', priceMinor: 12000 },
    { name: 'Espresso cups (x6)', priceMinor: 3550 },
    { name: 'Oak serving board', priceMinor: 6500 },
    { name: 'Cotton napkins (x4)', priceMinor: 2400 },
    { name: 'Stoneware dinner plates (x4)', priceMinor: 8900 },
  ],
  maxQuantityPerItem: 5,
  maxDiscountPercent: 10,
  taxPercent: 0,
  shippingMinor: 0,
  approvalThresholdMinor: 30_000,
  maxOrdersPerTask: 1,
};

const normalized = (name: string) => name.trim().toLowerCase();

// The catalogue product with this name; case and surrounding spaces don't matter.
export function findCatalogueItem(catalogue: ShopCatalogue, name: string): CatalogueItem | undefined {
  return catalogue.items.find((item) => normalized(item.name) === normalized(name));
}

// A product's price as PayPal writes amounts ("49.99"), for the demo's sample payments.
export function priceValueOf(name: string, catalogue: ShopCatalogue = SHOP_CATALOGUE): string {
  const item = findCatalogueItem(catalogue, name);
  if (!item) throw new Error(`${name} is not in the shop catalogue`);
  return (item.priceMinor / 100).toFixed(2);
}
