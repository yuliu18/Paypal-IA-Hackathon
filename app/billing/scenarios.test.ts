import { describe, expect, it } from 'vitest';
import type { SeedCharge } from '@/lib/demo-seed';
import { buildBillingScenarios } from './scenarios';

const charge = (customerEmail: string, description: string, orderId: string, value: string): SeedCharge => ({
  customerEmail,
  description,
  orderId,
  captureId: `CAP-${orderId}`,
  status: 'COMPLETED',
  amount: { value, currency_code: 'USD' },
});
const charges = [
  charge('ana@example.com', 'Ceramic mug set', 'O-ANA', '49.99'),
  charge('ben@example.com', 'Linen tablecloth', 'O-BEN', '120.00'),
  charge('carla@example.com', 'Espresso cups (x6)', 'O-CARLA', '35.50'),
];

describe('buildBillingScenarios', () => {
  it('builds the legitimate, held and injected tasks from the sample payments', () => {
    const scenarios = buildBillingScenarios(charges);
    expect(scenarios.map((s) => [s.label, s.agent, s.customerEmail])).toEqual([
      ['Invoice extra items', 'careful', 'ana@example.com'],
      ['Invoice over the approval limit', 'careful', 'ben@example.com'],
      ['Injected invoice, vulnerable agent', 'vulnerable', 'ana@example.com'],
    ]);
  });

  it('bills ana two more of her item at its price, under the approval threshold', () => {
    const { message } = buildBillingScenarios(charges)[0];
    expect(message).toContain('two more');
    expect(message).toContain('ceramic mug set');
    expect(message).toContain('O-ANA');
    expect(message).toContain('49.99 USD each');
    expect(message).toContain('99.98 USD');
    expect(message).toMatch(/send it/i);
  });

  it('bills ben 180.00 USD, over the 100 USD approval threshold and under the 500 USD maximum', () => {
    const { message } = buildBillingScenarios(charges)[1];
    expect(message).toContain('180.00 USD');
    expect(message).toContain('O-BEN');
  });

  it('hides an order to bill carla 450 USD with a copy to an outside address in a legitimate task for ana', () => {
    const { message } = buildBillingScenarios(charges)[2];
    expect(message).toContain('49.99 USD');
    expect(message).toContain('carla@example.com');
    expect(message).toContain('450.00 USD');
    expect(message).toContain('additional_recipients');
    expect(message).toMatch(/@[a-z-]+\.example/);
  });

  it('has no tasks without the three sample payments', () => {
    expect(buildBillingScenarios([])).toEqual([]);
    expect(buildBillingScenarios(charges.slice(0, 2))).toEqual([]);
  });
});
