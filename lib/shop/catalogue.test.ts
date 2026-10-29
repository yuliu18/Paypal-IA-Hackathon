import { describe, expect, it } from 'vitest';
import { findCatalogueItem, priceValueOf, SHOP_CATALOGUE } from './catalogue';

describe('shop catalogue', () => {
  it('sells the three products of the sample payments at the prices they were charged', () => {
    expect(priceValueOf('Ceramic mug set')).toBe('49.99');
    expect(priceValueOf('Linen tablecloth')).toBe('120.00');
    expect(priceValueOf('Espresso cups (x6)')).toBe('35.50');
  });

  it('has more products than the sample payments, each named once and priced in cents', () => {
    expect(SHOP_CATALOGUE.items.length).toBeGreaterThan(3);
    const names = SHOP_CATALOGUE.items.map((item) => item.name.toLowerCase());
    expect(new Set(names).size).toBe(names.length);
    expect(SHOP_CATALOGUE.items.every((item) => Number.isSafeInteger(item.priceMinor) && item.priceMinor > 0)).toBe(true);
  });

  it('carries the assumed shop rules: USD, 5 per item, 10 % discount, no tax, free shipping, approval over 300.00, one order', () => {
    expect(SHOP_CATALOGUE).toMatchObject({
      currency: 'USD',
      maxQuantityPerItem: 5,
      maxDiscountPercent: 10,
      taxPercent: 0,
      shippingMinor: 0,
      approvalThresholdMinor: 30_000,
      maxOrdersPerTask: 1,
    });
  });

  it('finds a product by its name, ignoring case and surrounding spaces, and nothing else', () => {
    expect(findCatalogueItem(SHOP_CATALOGUE, '  ceramic MUG set ')).toEqual({ name: 'Ceramic mug set', priceMinor: 4999 });
    expect(findCatalogueItem(SHOP_CATALOGUE, 'Ceramic mug')).toBeUndefined();
    expect(() => priceValueOf('Gold mug')).toThrow('Gold mug is not in the shop catalogue');
  });
});
