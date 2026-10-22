import { describe, expect, it } from 'vitest';
import { CURRENCIES } from './currencies';

describe('currencies', () => {
  it("lists PayPal's 24 currencies, marking those without decimals", () => {
    expect(CURRENCIES).toHaveLength(24);
    expect(CURRENCIES.find((c) => c.code === 'EUR')).toEqual({ code: 'EUR', name: 'Euro', decimals: 2 });
    expect(CURRENCIES.filter((c) => c.decimals === 0).map((c) => c.code)).toEqual(['HUF', 'JPY', 'TWD']);
  });
});
