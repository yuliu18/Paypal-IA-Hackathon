// Deterministic dispute policy: the rules accepting a dispute claim must pass before it may reach
// PayPal. Accepting a claim closes the dispute in the customer's favor and PayPal refunds the
// disputed amount from the shop's account, so it is a refund of the disputed capture and passes
// every refund rule, plus one of its own: the dispute must still wait for the shop's answer.

import { evaluateRefund, type CaptureFacts, type Decision, type Limits, type Money, type TaskMandate, type Violation } from './policy';

export type DisputeFacts = {
  id: string;
  status: string;
  amount: Money;
  // The shop's capture the customer disputes; null when PayPal names none, or more than one.
  captureId: string | null;
};

export type DisputeAcceptanceContext = {
  dispute: DisputeFacts;
  // The disputed capture, which says whose payment it was and how much is still refundable.
  capture: CaptureFacts;
  mandate: TaskMandate;
  limits: Limits;
  refundedToday: Money;
};

// A plain PayPal dispute id (e.g. PP-D-27803). The toolkit pastes it into the request path, so a
// slash or dot could point the call at another PayPal resource.
export const DISPUTE_ID = /^[A-Za-z0-9_-]{1,64}$/;

// The states in which the shop can still answer; in the others PayPal or the customer decides.
const ACCEPTABLE = new Set(['OPEN', 'WAITING_FOR_SELLER_RESPONSE']);

// While the buyer disputes a payment, PayPal puts its capture on PENDING for BUYER_COMPLAINT and
// holds the shop's share back as a pending refund. Accepting the claim settles that hold rather
// than refunding on top of it, so the capture counts as refundable and pending refunds up to the
// disputed amount count as the hold. Completed refunds, and pending ones beyond it, still count.
function withoutDisputeHold(capture: CaptureFacts, disputed: Money): CaptureFacts {
  if (capture.status !== 'PENDING' || capture.statusReason !== 'BUYER_COMPLAINT') return capture;
  const pending = capture.pendingRefunded;
  const hold = pending && pending.currency === disputed.currency ? Math.min(pending.minor, disputed.minor) : 0;
  const refunded = { ...capture.refunded, minor: capture.refunded.minor - hold };
  return { ...capture, status: refunded.minor > 0 ? 'PARTIALLY_REFUNDED' : 'COMPLETED', refunded };
}

export function evaluateDisputeAcceptance({ dispute, capture, mandate, limits, refundedToday }: DisputeAcceptanceContext): Decision {
  const own: Violation[] = [];
  if (!ACCEPTABLE.has(dispute.status)) {
    own.push({ code: 'DISPUTE_NOT_ACCEPTABLE', message: `Dispute status is ${dispute.status || 'unknown'}` });
  }
  if (dispute.captureId !== capture.captureId) {
    own.push({ code: 'CAPTURE_MISMATCH', message: `Dispute ${dispute.id} is not about capture ${capture.captureId}` });
  }
  // The refund rules see the disputed amount as the refund: its owner, what is still refundable
  // (a refund already made would be paid twice), and the per-refund, daily and approval limits.
  const refund = evaluateRefund({
    request: { captureId: capture.captureId, amount: dispute.amount },
    capture: withoutDisputeHold(capture, dispute.amount),
    mandate,
    limits,
    refundedToday,
  });
  if (refund.verdict === 'block') return { verdict: 'block', violations: [...own, ...refund.violations] };
  // A blocked acceptance never waits for a person, so the approval threshold isn't a reason here.
  if (own.length) return { verdict: 'block', violations: own };
  return refund;
}
