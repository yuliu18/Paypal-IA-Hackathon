// Deterministic refund policy: the rules a refund must pass before it may reach PayPal. Pure
// functions with no I/O, so the guard's core decision is fully testable. Amounts are integer
// minor units (cents) to avoid floating-point money.

export type Money = { minor: number; currency: string };

// `hold` parks a call for a person to decide; it never runs on its own.
export type Verdict = 'allow' | 'hold' | 'block';

export type ViolationCode =
  | 'CAPTURE_MISMATCH'
  | 'CAPTURE_NOT_REFUNDABLE'
  | 'CURRENCY_MISMATCH'
  | 'NOTHING_TO_REFUND'
  | 'AMOUNT_EXCEEDS_REFUNDABLE'
  | 'CUSTOMER_MISMATCH'
  | 'PER_REFUND_LIMIT'
  | 'DAILY_LIMIT'
  | 'INTENT_MISMATCH'
  | 'APPROVAL_REQUIRED'
  | 'INTENT_UNCERTAIN';

export type Violation = { code: ViolationCode | string; message: string };

export type Decision = { verdict: Verdict; violations: Violation[] };

export type RefundRequest = {
  captureId: string;
  // Omitted means PayPal refunds everything still refundable on the capture.
  amount?: Money;
};

export type CaptureFacts = {
  captureId: string;
  status: string;
  captured: Money;
  refunded: Money;
  customerEmail: string | null;
};

// What the business authorized the agent to do for the task at hand.
export type TaskMandate = { customerEmail: string };

// Above `approvalThreshold` a clean refund waits for a person; above `perRefund` it is always blocked.
export type Limits = { approvalThreshold: Money; perRefund: Money; daily: Money };

export type RefundContext = {
  request: RefundRequest;
  capture: CaptureFacts;
  mandate: TaskMandate;
  limits: Limits;
  refundedToday: Money;
};

const format = (m: Money) => `${(m.minor / 100).toFixed(2)} ${m.currency}`;

// A limit in another currency can't be compared, so it fails closed.
const exceeds = (amount: Money, limit: Money) => amount.currency !== limit.currency || amount.minor > limit.minor;

const normalizeEmail = (email: string) => email.trim().toLowerCase();

// Whether a customer recorded by the shop is the one the agent works for. Unknown never matches.
export const isMandateCustomer = (customerEmail: string | null | undefined, mandate: TaskMandate) =>
  !!customerEmail && normalizeEmail(customerEmail) === normalizeEmail(mandate.customerEmail);

// What PayPal can still refund on a capture: an omitted refund amount means all of it.
export const refundableOf = (capture: CaptureFacts): Money => ({
  minor: capture.captured.minor - capture.refunded.minor,
  currency: capture.captured.currency,
});

export function evaluateRefund({ request, capture, mandate, limits, refundedToday }: RefundContext): Decision {
  const violations: Violation[] = [];
  const refundable = refundableOf(capture);
  const amount = request.amount ?? refundable;

  if (request.captureId !== capture.captureId) {
    violations.push({ code: 'CAPTURE_MISMATCH', message: `Capture ${capture.captureId} does not match requested ${request.captureId}` });
  }
  if (capture.status !== 'COMPLETED' && capture.status !== 'PARTIALLY_REFUNDED') {
    violations.push({ code: 'CAPTURE_NOT_REFUNDABLE', message: `Capture status is ${capture.status}` });
  }

  if (amount.currency !== refundable.currency) {
    violations.push({ code: 'CURRENCY_MISMATCH', message: `Refund in ${amount.currency}, capture in ${refundable.currency}` });
  } else if (amount.minor <= 0) {
    violations.push({ code: 'NOTHING_TO_REFUND', message: `Refund ${format(amount)} moves no money; refundable is ${format(refundable)}` });
  } else if (amount.minor > refundable.minor) {
    violations.push({ code: 'AMOUNT_EXCEEDS_REFUNDABLE', message: `Refund ${format(amount)} exceeds refundable ${format(refundable)}` });
  }

  if (!isMandateCustomer(capture.customerEmail, mandate)) {
    violations.push({ code: 'CUSTOMER_MISMATCH', message: `Capture customer is not the ticket customer ${mandate.customerEmail}` });
  }

  if (exceeds(amount, limits.perRefund)) {
    violations.push({ code: 'PER_REFUND_LIMIT', message: `Refund ${format(amount)} is over the per-refund limit ${format(limits.perRefund)}` });
  }
  const dayTotal: Money = { minor: refundedToday.minor + amount.minor, currency: amount.currency };
  if (refundedToday.currency !== amount.currency || exceeds(dayTotal, limits.daily)) {
    violations.push({ code: 'DAILY_LIMIT', message: `Refunds today would reach ${format(dayTotal)}, over ${format(limits.daily)}` });
  }

  if (violations.length) return { verdict: 'block', violations };
  if (exceeds(amount, limits.approvalThreshold)) {
    return {
      verdict: 'hold',
      violations: [{ code: 'APPROVAL_REQUIRED', message: `Refund ${format(amount)} is over the approval threshold ${format(limits.approvalThreshold)}` }],
    };
  }
  return { verdict: 'allow', violations: [] };
}

const STRICTNESS: Record<Verdict, number> = { allow: 0, hold: 1, block: 2 };

// The intent judge can only make a decision stricter: block > hold > allow, and a policy block always stands.
export function mergeDecisions(policy: Decision, judge: Decision): Decision {
  const violations = [...policy.violations, ...judge.violations];
  const verdict = STRICTNESS[judge.verdict] > STRICTNESS[policy.verdict] ? judge.verdict : policy.verdict;
  return { verdict, violations };
}
