import { describe, expect, it } from 'vitest';
import { evaluateRefund, mergeDecisions, type RefundContext } from './policy';

const usd = (minor: number) => ({ minor, currency: 'USD' });

function context(overrides: Partial<RefundContext> = {}): RefundContext {
  return {
    request: { captureId: 'CAP-1', amount: usd(2500) },
    capture: { captureId: 'CAP-1', status: 'COMPLETED', captured: usd(5000), refunded: usd(0), customerEmail: 'ana@example.com' },
    mandate: { customerEmail: 'ana@example.com' },
    limits: { approvalThreshold: usd(10000), perRefund: usd(10000), daily: usd(20000) },
    refundedToday: usd(0),
    ...overrides,
  };
}

const codes = (ctx: RefundContext) => evaluateRefund(ctx).violations.map((v) => v.code);

describe('evaluateRefund', () => {
  it('allows a partial refund for the ticket customer within every limit', () => {
    expect(evaluateRefund(context())).toEqual({ verdict: 'allow', violations: [] });
  });

  it('blocks a capture that is not completed', () => {
    const ctx = context({ capture: { ...context().capture, status: 'PENDING' } });
    expect(evaluateRefund(ctx).verdict).toBe('block');
    expect(codes(ctx)).toEqual(['CAPTURE_NOT_REFUNDABLE']);
  });

  it('blocks a refund larger than what is still refundable', () => {
    const ctx = context({
      request: { captureId: 'CAP-1', amount: usd(3000) },
      capture: { ...context().capture, refunded: usd(2500) },
    });
    expect(codes(ctx)).toEqual(['AMOUNT_EXCEEDS_REFUNDABLE']);
  });

  it('treats an omitted amount as a full refund of the remaining balance', () => {
    const ctx = context({ request: { captureId: 'CAP-1' }, limits: { approvalThreshold: usd(4000), perRefund: usd(4000), daily: usd(20000) } });
    expect(codes(ctx)).toEqual(['PER_REFUND_LIMIT']);
  });

  it('blocks a zero refund', () => {
    expect(codes(context({ request: { captureId: 'CAP-1', amount: usd(0) } }))).toEqual(['NOTHING_TO_REFUND']);
  });

  it('blocks an omitted amount when nothing is left to refund on the capture', () => {
    const ctx = context({ request: { captureId: 'CAP-1' }, capture: { ...context().capture, status: 'PARTIALLY_REFUNDED', refunded: usd(5000) } });
    expect(codes(ctx)).toEqual(['NOTHING_TO_REFUND']);
  });

  it('blocks a refund in a different currency, failing closed on limits it cannot compare', () => {
    const ctx = context({ request: { captureId: 'CAP-1', amount: { minor: 100, currency: 'EUR' } } });
    expect(codes(ctx)).toEqual(['CURRENCY_MISMATCH', 'PER_REFUND_LIMIT', 'DAILY_LIMIT']);
  });

  it('blocks a refund when the capture is for a different request id', () => {
    const ctx = context({ request: { captureId: 'CAP-2', amount: usd(100) } });
    expect(codes(ctx)).toEqual(['CAPTURE_MISMATCH']);
  });

  it('blocks a refund to a payer who is not the ticket customer', () => {
    const ctx = context({ mandate: { customerEmail: 'attacker@example.com' } });
    expect(codes(ctx)).toEqual(['CUSTOMER_MISMATCH']);
  });

  it('compares customer emails case-insensitively and blocks an unknown payer', () => {
    expect(codes(context({ mandate: { customerEmail: ' ANA@Example.com ' } }))).toEqual([]);
    expect(codes(context({ capture: { ...context().capture, customerEmail: null } }))).toEqual(['CUSTOMER_MISMATCH']);
  });

  it('blocks a refund above the per-refund limit', () => {
    const ctx = context({ limits: { approvalThreshold: usd(2000), perRefund: usd(2000), daily: usd(20000) } });
    expect(codes(ctx)).toEqual(['PER_REFUND_LIMIT']);
  });

  it('holds a clean refund above the approval threshold for a person to approve', () => {
    const ctx = context({ limits: { approvalThreshold: usd(2000), perRefund: usd(10000), daily: usd(20000) } });
    expect(evaluateRefund(ctx)).toEqual({
      verdict: 'hold',
      violations: [{ code: 'APPROVAL_REQUIRED', message: 'Refund 25.00 USD is over the approval threshold 20.00 USD' }],
    });
  });

  it('allows a refund exactly at the approval threshold', () => {
    const ctx = context({ limits: { approvalThreshold: usd(2500), perRefund: usd(10000), daily: usd(20000) } });
    expect(evaluateRefund(ctx).verdict).toBe('allow');
  });

  it('blocks rather than holds a refund above the threshold that also breaks a rule', () => {
    const ctx = context({
      mandate: { customerEmail: 'ben@example.com' },
      limits: { approvalThreshold: usd(2000), perRefund: usd(10000), daily: usd(20000) },
    });
    expect(evaluateRefund(ctx).verdict).toBe('block');
    expect(codes(ctx)).toEqual(['CUSTOMER_MISMATCH']);
  });

  it('blocks a refund that would exceed the daily limit', () => {
    const ctx = context({ refundedToday: usd(18000) });
    expect(codes(ctx)).toEqual(['DAILY_LIMIT']);
  });

  it('reports every violated rule, not only the first', () => {
    const ctx = context({ mandate: { customerEmail: 'x@example.com' }, refundedToday: usd(19000) });
    expect(codes(ctx)).toEqual(['CUSTOMER_MISMATCH', 'DAILY_LIMIT']);
  });
});

describe('mergeDecisions', () => {
  const allow = { verdict: 'allow' as const, violations: [] };
  const block = { verdict: 'block' as const, violations: [{ code: 'INTENT_MISMATCH', message: 'not requested' }] };

  it('lets the judge make an allowed decision stricter', () => {
    expect(mergeDecisions(allow, block)).toEqual(block);
  });

  it('never lets the judge relax a policy block', () => {
    const policyBlock = { verdict: 'block' as const, violations: [{ code: 'DAILY_LIMIT', message: 'over' }] };
    expect(mergeDecisions(policyBlock, allow)).toEqual(policyBlock);
  });

  it('holds when either side holds and neither blocks', () => {
    const hold = { verdict: 'hold' as const, violations: [{ code: 'INTENT_UNCERTAIN', message: 'unclear' }] };
    expect(mergeDecisions(allow, hold)).toEqual(hold);
    expect(mergeDecisions(hold, allow)).toEqual(hold);
  });

  it('lets a block win over a hold on either side', () => {
    const hold = { verdict: 'hold' as const, violations: [{ code: 'APPROVAL_REQUIRED', message: 'over' }] };
    expect(mergeDecisions(hold, block).verdict).toBe('block');
    expect(mergeDecisions(block, hold).verdict).toBe('block');
  });

  it('keeps the violations of both sides when both block', () => {
    const policyBlock = { verdict: 'block' as const, violations: [{ code: 'DAILY_LIMIT', message: 'over' }] };
    expect(mergeDecisions(policyBlock, block).violations.map((v) => v.code)).toEqual(['DAILY_LIMIT', 'INTENT_MISMATCH']);
  });
});
