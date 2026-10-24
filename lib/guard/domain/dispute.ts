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
  const refund = evaluateRefund({ request: { captureId: capture.captureId, amount: dispute.amount }, capture, mandate, limits, refundedToday });
  if (refund.verdict === 'block') return { verdict: 'block', violations: [...own, ...refund.violations] };
  // A blocked acceptance never waits for a person, so the approval threshold isn't a reason here.
  if (own.length) return { verdict: 'block', violations: own };
  return refund;
}
