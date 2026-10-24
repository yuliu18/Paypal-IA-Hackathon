import { describe, expect, it } from 'vitest';
import { evaluateDisputeAcceptance, type DisputeAcceptanceContext } from './dispute';

const usd = (minor: number) => ({ minor, currency: 'USD' });

function context(overrides: Partial<DisputeAcceptanceContext> = {}): DisputeAcceptanceContext {
  return {
    dispute: { id: 'PP-D-1', status: 'WAITING_FOR_SELLER_RESPONSE', amount: usd(2000), captureId: 'CAP-1' },
    capture: { captureId: 'CAP-1', status: 'COMPLETED', captured: usd(2000), refunded: usd(0), customerEmail: 'ana@example.com' },
    mandate: { customerEmail: 'ana@example.com' },
    limits: { approvalThreshold: usd(5000), perRefund: usd(20000), daily: usd(50000) },
    refundedToday: usd(0),
    ...overrides,
  };
}

const codes = (ctx: DisputeAcceptanceContext) => evaluateDisputeAcceptance(ctx).violations.map((v) => v.code);
const withDispute = (patch: Partial<DisputeAcceptanceContext['dispute']>) => context({ dispute: { ...context().dispute, ...patch } });
const withCapture = (patch: Partial<DisputeAcceptanceContext['capture']>) => context({ capture: { ...context().capture, ...patch } });

describe('evaluateDisputeAcceptance', () => {
  it("allows accepting an open claim on the ticket customer's payment, under the approval threshold", () => {
    expect(evaluateDisputeAcceptance(context())).toEqual({ verdict: 'allow', violations: [] });
    expect(evaluateDisputeAcceptance(withDispute({ status: 'OPEN' }))).toEqual({ verdict: 'allow', violations: [] });
  });

  it('blocks a dispute the shop can no longer answer', () => {
    for (const status of ['WAITING_FOR_BUYER_RESPONSE', 'UNDER_REVIEW', 'RESOLVED', 'OTHER', '']) {
      const ctx = withDispute({ status });
      expect(evaluateDisputeAcceptance(ctx).verdict).toBe('block');
      expect(codes(ctx)).toEqual(['DISPUTE_NOT_ACCEPTABLE']);
    }
  });

  it("blocks a claim on another customer's payment, or one whose owner is unknown", () => {
    expect(codes(withCapture({ customerEmail: 'ben@example.com' }))).toEqual(['CUSTOMER_MISMATCH']);
    expect(codes(withCapture({ customerEmail: null }))).toEqual(['CUSTOMER_MISMATCH']);
  });

  it('blocks when the capture looked up is not the disputed one', () => {
    expect(codes(withDispute({ captureId: 'CAP-2' }))).toEqual(['CAPTURE_MISMATCH']);
    expect(codes(withDispute({ captureId: null }))).toEqual(['CAPTURE_MISMATCH']);
  });

  it('blocks a claim on a payment already refunded, which would pay the customer twice', () => {
    expect(codes(withCapture({ refunded: usd(2000), status: 'REFUNDED' }))).toEqual(['CAPTURE_NOT_REFUNDABLE', 'AMOUNT_EXCEEDS_REFUNDABLE']);
    expect(codes(withCapture({ refunded: usd(500), status: 'PARTIALLY_REFUNDED' }))).toEqual(['AMOUNT_EXCEEDS_REFUNDABLE']);
  });

  it('applies the per-refund and daily limits to the disputed amount', () => {
    const big = context({
      dispute: { ...context().dispute, amount: usd(30000) },
      capture: { ...context().capture, captured: usd(30000) },
    });
    expect(codes(big)).toEqual(['PER_REFUND_LIMIT']);
    expect(codes(context({ refundedToday: usd(49000) }))).toEqual(['DAILY_LIMIT']);
  });

  it('holds a clean claim over the approval threshold for a person', () => {
    const ctx = context({ dispute: { ...context().dispute, amount: usd(8000) }, capture: { ...context().capture, captured: usd(8000) } });
    expect(evaluateDisputeAcceptance(ctx)).toMatchObject({ verdict: 'hold', violations: [{ code: 'APPROVAL_REQUIRED' }] });
  });

  it('never holds a blocked claim: the approval threshold is left out of its reasons', () => {
    const ctx = context({
      dispute: { ...context().dispute, amount: usd(8000), status: 'RESOLVED' },
      capture: { ...context().capture, captured: usd(8000) },
    });
    expect(evaluateDisputeAcceptance(ctx)).toEqual({ verdict: 'block', violations: [expect.objectContaining({ code: 'DISPUTE_NOT_ACCEPTABLE' })] });
  });
});
