import { describe, expect, it } from 'vitest';
import { evaluateCancellation, type CancellationContext } from './cancellation';

function context(overrides: Partial<CancellationContext> = {}): CancellationContext {
  return {
    subscription: { id: 'I-SUB1', status: 'ACTIVE', customerEmail: 'ana@example.com' },
    mandate: { customerEmail: 'ana@example.com' },
    cancellationsThisTicket: 0,
    ...overrides,
  };
}

const codes = (ctx: CancellationContext) => evaluateCancellation(ctx).violations.map((v) => v.code);

describe('evaluateCancellation', () => {
  it('allows cancelling an active or suspended subscription of the ticket customer', () => {
    expect(evaluateCancellation(context())).toEqual({ verdict: 'allow', violations: [] });
    const suspended = context({ subscription: { ...context().subscription, status: 'SUSPENDED' } });
    expect(evaluateCancellation(suspended)).toEqual({ verdict: 'allow', violations: [] });
  });

  it("blocks another customer's subscription, comparing emails case-insensitively", () => {
    expect(codes(context({ subscription: { ...context().subscription, customerEmail: 'ben@example.com' } }))).toEqual(['CUSTOMER_MISMATCH']);
    expect(codes(context({ subscription: { ...context().subscription, customerEmail: ' ANA@example.com ' } }))).toEqual([]);
  });

  it('blocks a subscription whose owner is unknown', () => {
    expect(codes(context({ subscription: { id: 'I-SUB1', status: 'ACTIVE' } }))).toEqual(['CUSTOMER_MISMATCH']);
    expect(codes(context({ subscription: { id: 'I-SUB1', status: 'ACTIVE', customerEmail: null } }))).toEqual(['CUSTOMER_MISMATCH']);
  });

  it('blocks a subscription that is not active or suspended', () => {
    for (const status of ['APPROVAL_PENDING', 'APPROVED', 'CANCELLED', 'EXPIRED', '']) {
      const ctx = context({ subscription: { ...context().subscription, status } });
      expect(evaluateCancellation(ctx).verdict).toBe('block');
      expect(codes(ctx)).toEqual(['SUBSCRIPTION_NOT_CANCELLABLE']);
    }
  });

  it('blocks a second cancellation in the same ticket', () => {
    expect(codes(context({ cancellationsThisTicket: 1 }))).toEqual(['CANCELLATION_LIMIT']);
  });

  it('reports every broken rule at once', () => {
    const ctx = context({ subscription: { id: 'I-SUB1', status: 'CANCELLED', customerEmail: 'ben@example.com' }, cancellationsThisTicket: 1 });
    expect(codes(ctx)).toEqual(['CUSTOMER_MISMATCH', 'SUBSCRIPTION_NOT_CANCELLABLE', 'CANCELLATION_LIMIT']);
  });
});
