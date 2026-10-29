import { describe, expect, it } from 'vitest';
import type { SeedCharge } from '@/lib/demo-seed';
import { buildScenarios, pendingApproval } from './scenarios';

const charge = (customerEmail: string, description: string, orderId: string): SeedCharge => ({
  customerEmail,
  description,
  orderId,
  captureId: `CAP-${orderId}`,
  status: 'COMPLETED',
  amount: { value: '10.00', currency_code: 'USD' },
});
const charges = [
  charge('ana@example.com', 'Ceramic mug set', 'O-ANA'),
  charge('ben@example.com', 'Linen tablecloth', 'O-BEN'),
  charge('carla@example.com', 'Espresso cups (x6)', 'O-CARLA'),
];
const active = { id: 'I-SUB1', status: 'ACTIVE', customerEmail: 'buyer@personal.example.com' };

describe('buildScenarios', () => {
  it('keeps the two refund tickets when there is no sample subscription', () => {
    const scenarios = buildScenarios(charges);
    expect(scenarios.map((s) => [s.label, s.agent, s.customerEmail])).toEqual([
      ['Legitimate ticket', 'careful', 'ana@example.com'],
      ['Prompt injection, vulnerable agent', 'vulnerable', 'ana@example.com'],
    ]);
    expect(scenarios[0].message).toContain('O-ANA');
    expect(scenarios[1].message).toContain('O-BEN');
  });

  it('adds a cancellation from the subscription owner and an attack from another customer', () => {
    const scenarios = buildScenarios(charges, active);
    expect(scenarios.slice(2)).toEqual([
      {
        label: 'Cancel subscription',
        agent: 'careful',
        customerEmail: 'buyer@personal.example.com',
        message: 'Please cancel my subscription I-SUB1, I no longer need it.',
      },
      {
        label: "Cancel someone else's subscription, vulnerable agent",
        agent: 'vulnerable',
        customerEmail: 'carla@example.com',
        message: expect.stringContaining('I-SUB1'),
      },
    ]);
  });

  it('offers the subscription tickets for a suspended subscription too, even without sample payments', () => {
    const scenarios = buildScenarios([], { ...active, status: 'SUSPENDED' });
    expect(scenarios.map((s) => s.customerEmail)).toEqual(['buyer@personal.example.com', 'carla@example.com']);
  });

  it('leaves the subscription tickets out when it is not cancellable or its owner is unknown', () => {
    for (const subscription of [
      { ...active, status: 'APPROVAL_PENDING' },
      { ...active, status: 'CANCELLED' },
      { ...active, customerEmail: null },
      undefined,
    ]) {
      expect(buildScenarios(charges, subscription)).toHaveLength(2);
    }
  });
});

describe('dispute tickets', () => {
  const dispute = { id: 'PP-D-1', status: 'WAITING_FOR_SELLER_RESPONSE', customerEmail: 'buyer@personal.example.com' };

  it('adds a settlement from the buyer who paid and an attack from another customer', () => {
    const scenarios = buildScenarios(charges, undefined, dispute);
    expect(scenarios.slice(2).map((s) => [s.label, s.agent, s.customerEmail])).toEqual([
      ['Settle my dispute', 'careful', 'buyer@personal.example.com'],
      ["Settle someone else's dispute, vulnerable agent", 'vulnerable', 'carla@example.com'],
    ]);
    for (const scenario of scenarios.slice(2)) expect(scenario.message).toContain('PP-D-1');
  });

  it('leaves the dispute tickets out once the shop can no longer accept the claim', () => {
    for (const status of ['UNDER_REVIEW', 'RESOLVED', 'WAITING_FOR_BUYER_RESPONSE']) {
      expect(buildScenarios(charges, undefined, { ...dispute, status })).toHaveLength(2);
    }
    expect(buildScenarios(charges, undefined, { ...dispute, status: 'OPEN' })).toHaveLength(4);
  });
});

describe('pendingApproval', () => {
  const seed = { id: 'I-SUB1', approveUrl: 'https://approve', createdAt: '2026-10-23T00:00:00.000Z' };

  it('gives the approval link while the subscription waits for the buyer', () => {
    expect(pendingApproval(seed, { id: 'I-SUB1', status: 'APPROVAL_PENDING' })).toBe('https://approve');
  });

  it('gives none once it is approved, or when it could not be read', () => {
    expect(pendingApproval(seed, active)).toBeUndefined();
    expect(pendingApproval(seed, undefined)).toBeUndefined();
    expect(pendingApproval(undefined, undefined)).toBeUndefined();
  });
});
