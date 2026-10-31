import { describe, expect, it } from 'vitest';
import { SHOP_CATALOGUE } from '../../shop/catalogue';
import { evaluateOrderCreation, parseOrderDraft, type OrderDraft } from './order';

const SHOP = 'https://shop.example';

// create_order's arguments as the toolkit takes them: 2 mug sets for 99.98 USD.
const orderArgs = (overrides: Record<string, unknown> = {}) => ({
  currencyCode: 'USD',
  items: [{ name: 'Ceramic mug set', quantity: 2, itemCost: 49.99, taxPercent: 0, itemTotal: 99.98 }],
  discount: 0,
  shippingCost: 0,
  returnUrl: `${SHOP}/sales/paypal-return`,
  cancelUrl: `${SHOP}/sales`,
  ...overrides,
});

function draftOf(args: Record<string, unknown>): OrderDraft {
  const parsed = parseOrderDraft(args);
  if ('invalid' in parsed) throw new Error(parsed.invalid);
  return parsed.draft;
}

const evaluate = (args: Record<string, unknown>, ordersThisTask = 0, approvalThresholdMinor: number | null = SHOP_CATALOGUE.approvalThresholdMinor) =>
  evaluateOrderCreation({ draft: draftOf(args), catalogue: SHOP_CATALOGUE, shopOrigin: SHOP, ordersThisTask, approvalThresholdMinor });
const codes = (args: Record<string, unknown>, ordersThisTask = 0) => evaluate(args, ordersThisTask).violations.map((v) => v.code);

describe('parseOrderDraft', () => {
  it('reads the order as the toolkit sends it to PayPal, in exact cents', () => {
    expect(draftOf(orderArgs())).toEqual({
      currency: 'USD',
      lines: [{ name: 'Ceramic mug set', quantity: 2, itemCostMinor: 4999, taxBasisPoints: 0, itemTotalMinor: 9998 }],
      subtotalMinor: 9998,
      taxMinor: 0,
      discountMinor: 0,
      shippingMinor: 0,
      totalMinor: 9998,
      returnUrl: `${SHOP}/sales/paypal-return`,
      cancelUrl: `${SHOP}/sales`,
    });
  });

  it('applies the toolkit defaults: quantity 1, no tax, no discount, no shipping', () => {
    const draft = draftOf({ currencyCode: 'USD', items: [{ name: 'Linen tablecloth', itemCost: 120, itemTotal: 120 }] });
    expect(draft).toMatchObject({ lines: [{ quantity: 1, taxBasisPoints: 0 }], discountMinor: 0, shippingMinor: 0, totalMinor: 12000 });
    expect(draft.returnUrl).toBeUndefined();
  });

  it('computes the total as PayPal will charge it: items plus tax plus shipping minus the discount', () => {
    const draft = draftOf(orderArgs({ items: [{ name: 'Linen tablecloth', quantity: 1, itemCost: 120, taxPercent: 7.5, itemTotal: 120 }], discount: 12, shippingCost: 4.99 }));
    expect(draft).toMatchObject({ subtotalMinor: 12000, taxMinor: 900, discountMinor: 1200, shippingMinor: 499, totalMinor: 12199 });
  });

  it('refuses arguments the toolkit would reject or that are not plain amounts', () => {
    const malformed = [
      orderArgs({ currencyCode: undefined }),
      orderArgs({ items: [] }),
      orderArgs({ items: 'mugs' }),
      orderArgs({ items: [{ quantity: 1, itemCost: 49.99, itemTotal: 49.99 }] }),
      orderArgs({ items: [{ name: 'Ceramic mug set', quantity: 0, itemCost: 49.99, itemTotal: 0 }] }),
      orderArgs({ items: [{ name: 'Ceramic mug set', quantity: 1.5, itemCost: 49.99, itemTotal: 74.99 }] }),
      orderArgs({ items: [{ name: 'Ceramic mug set', quantity: 1, itemCost: 49.999, itemTotal: 49.99 }] }),
      orderArgs({ items: [{ name: 'Ceramic mug set', quantity: 1, itemCost: -49.99, itemTotal: -49.99 }] }),
      orderArgs({ items: [{ name: 'Ceramic mug set', quantity: 1, itemCost: '49.99', itemTotal: 49.99 }] }),
      orderArgs({ discount: -5 }),
      orderArgs({ shippingCost: Number.NaN }),
      orderArgs({ returnUrl: 42 }),
      orderArgs({ discount: 1000 }),
    ];
    for (const args of malformed) expect(parseOrderDraft(args)).toHaveProperty('invalid');
  });

  it('refuses a JSON null in any amount, as the toolkit does: its defaults fill in only a missing value', () => {
    const mugs = { name: 'Ceramic mug set', quantity: 2, itemCost: 49.99, taxPercent: 0, itemTotal: 99.98 };
    const nulls = [
      orderArgs({ items: [{ ...mugs, quantity: null }] }),
      orderArgs({ items: [{ ...mugs, taxPercent: null }] }),
      orderArgs({ items: [{ ...mugs, itemCost: null }] }),
      orderArgs({ items: [{ ...mugs, itemTotal: null }] }),
      orderArgs({ discount: null }),
      orderArgs({ shippingCost: null }),
    ];
    for (const args of nulls) expect(parseOrderDraft(args)).toHaveProperty('invalid');
    // A missing one still takes the toolkit's default.
    expect(parseOrderDraft(orderArgs({ discount: undefined, shippingCost: undefined }))).toHaveProperty('draft');
  });
});

describe('evaluateOrderCreation', () => {
  it('allows catalogue items at catalogue prices, within the limits, returning to the shop', () => {
    expect(evaluate(orderArgs())).toEqual({ verdict: 'allow', violations: [] });
    expect(evaluate(orderArgs({ discount: 9.99 }))).toEqual({ verdict: 'allow', violations: [] });
  });

  it('blocks an item the shop does not sell', () => {
    const decision = evaluate(orderArgs({ items: [{ name: 'Gold watch', quantity: 1, itemCost: 10, taxPercent: 0, itemTotal: 10 }] }));
    expect(decision).toEqual({ verdict: 'block', violations: [{ code: 'NOT_IN_CATALOGUE', message: 'Gold watch is not in the shop catalogue' }] });
  });

  it('blocks an item at any price but its catalogue price', () => {
    const decision = evaluate(orderArgs({ items: [{ name: 'Linen tablecloth', quantity: 1, itemCost: 1.2, taxPercent: 0, itemTotal: 1.2 }] }));
    expect(decision).toEqual({ verdict: 'block', violations: [{ code: 'PRICE_MISMATCH', message: 'Linen tablecloth costs 120.00 USD in the catalogue, not 1.20 USD' }] });
  });

  it('blocks more than the per-item maximum, counting every line of the same product', () => {
    expect(codes(orderArgs({ items: [{ name: 'Ceramic mug set', quantity: 6, itemCost: 49.99, taxPercent: 0, itemTotal: 299.94 }] }))).toEqual(['QUANTITY_LIMIT']);
    const split = [3, 3].map((quantity) => ({ name: 'Ceramic mug set', quantity, itemCost: 49.99, taxPercent: 0, itemTotal: 149.97 }));
    const decision = evaluate(orderArgs({ items: split }));
    expect(decision).toEqual({ verdict: 'block', violations: [{ code: 'QUANTITY_LIMIT', message: 'Ceramic mug set: 6 ordered, at most 5 per order' }] });
    expect(codes(orderArgs({ items: [{ name: 'Ceramic mug set', quantity: 1_000_000_000, itemCost: 49.99, taxPercent: 0, itemTotal: 49_990_000_000 }] }))).toEqual(['QUANTITY_LIMIT']);
  });

  it('blocks a tax rate other than the catalogue one', () => {
    expect(codes(orderArgs({ items: [{ name: 'Ceramic mug set', quantity: 2, itemCost: 49.99, taxPercent: 5, itemTotal: 99.98 }] }))).toEqual(['TAX_MISMATCH']);
  });

  it('blocks an item total that is not its price times its quantity', () => {
    const decision = evaluate(orderArgs({ items: [{ name: 'Ceramic mug set', quantity: 2, itemCost: 49.99, taxPercent: 0, itemTotal: 49.99 }] }));
    expect(decision).toEqual({ verdict: 'block', violations: [{ code: 'ORDER_INVALID', message: 'Ceramic mug set: itemTotal 49.99 USD is not 2 x 49.99 USD' }] });
  });

  it('blocks a discount over 10 % of the items, such as the 90 % a customer demands', () => {
    const decision = evaluate(orderArgs({ discount: 89.98 }));
    expect(decision).toEqual({ verdict: 'block', violations: [{ code: 'DISCOUNT_LIMIT', message: 'Discount 89.98 USD is over 10 % of the items, at most 9.99 USD' }] });
    expect(codes(orderArgs({ discount: 10 }))).toEqual(['DISCOUNT_LIMIT']);
  });

  it('blocks a shipping cost other than the catalogue one', () => {
    expect(evaluate(orderArgs({ shippingCost: 25 }))).toEqual({ verdict: 'block', violations: [{ code: 'SHIPPING_MISMATCH', message: 'Shipping is 0.00 USD in the catalogue, not 25.00 USD' }] });
  });

  it('blocks a currency the shop does not sell in', () => {
    expect(codes(orderArgs({ currencyCode: 'EUR' }))).toEqual(['CURRENCY_MISMATCH']);
  });

  it('blocks return and cancel links anywhere but the shop, and missing ones, since the toolkit would send the buyer to example.com', () => {
    const elsewhere = [
      { returnUrl: 'https://evil.example/pay' },
      { cancelUrl: 'http://shop.example/sales' },
      { returnUrl: 'https://shop.example.evil.example/x' },
      { returnUrl: 'https://shop.example@evil.example/x' },
      { returnUrl: 'not a url' },
      { returnUrl: undefined },
      { cancelUrl: undefined },
    ];
    for (const override of elsewhere) expect(codes(orderArgs(override))).toEqual(['RETURN_URL_NOT_SHOP']);
    const decision = evaluate(orderArgs({ returnUrl: 'https://evil.example/pay' }));
    expect(decision.violations[0].message).toBe('returnUrl must be a page of the shop https://shop.example');
  });

  it('blocks a second order in the same conversation', () => {
    expect(evaluate(orderArgs(), 1)).toEqual({ verdict: 'block', violations: [{ code: 'ORDER_LIMIT', message: 'A conversation may create at most 1 order' }] });
  });

  it('holds a clean order over the approval threshold, and allows it once a person lifts the threshold', () => {
    const big = orderArgs({ items: [{ name: 'Linen tablecloth', quantity: 3, itemCost: 120, taxPercent: 0, itemTotal: 360 }] });
    expect(evaluate(big)).toEqual({
      verdict: 'hold',
      violations: [{ code: 'APPROVAL_REQUIRED', message: 'Order 360.00 USD is over the approval threshold 300.00 USD' }],
    });
    expect(evaluate(big, 0, null)).toEqual({ verdict: 'allow', violations: [] });
  });

  it('never holds an order it blocks', () => {
    const big = orderArgs({ items: [{ name: 'Linen tablecloth', quantity: 3, itemCost: 120, taxPercent: 0, itemTotal: 360 }], discount: 100 });
    expect(evaluate(big).verdict).toBe('block');
    expect(codes(big)).toEqual(['DISCOUNT_LIMIT']);
  });
});
