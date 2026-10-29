// Deterministic cancellation policy: the rules a subscription cancellation must pass before it may
// reach PayPal. Pure, like the refund policy. A cancellation moves no money, so there are no
// amounts or limits: only whose subscription it is, whether it can still be cancelled, and how many.

import { isMandateCustomer, type Decision, type TaskMandate, type Violation } from './policy';

export type SubscriptionFacts = {
  id: string;
  status: string;
  // The subscriber PayPal recorded; missing or null is an unknown owner, which never matches.
  customerEmail?: string | null;
};

export type CancellationContext = {
  subscription: SubscriptionFacts;
  mandate: TaskMandate;
  // Cancellations this ticket already ran or parked for a person.
  cancellationsThisTicket: number;
};

// A plain PayPal id (e.g. I-BW452GLLEP1G). The toolkit pastes it into the request path, so a slash
// or dot could point the call at another PayPal resource.
export const SUBSCRIPTION_ID = /^[A-Za-z0-9_-]{1,64}$/;

// Only these can be cancelled; PayPal refuses the rest, and a pending one isn't the customer's yet.
const CANCELLABLE = new Set(['ACTIVE', 'SUSPENDED']);

// One per ticket: a customer asks to cancel a subscription, not every subscription they have.
const MAX_CANCELLATIONS_PER_TICKET = 1;

export function evaluateCancellation({ subscription, mandate, cancellationsThisTicket }: CancellationContext): Decision {
  const violations: Violation[] = [];
  if (!isMandateCustomer(subscription.customerEmail, mandate)) {
    violations.push({ code: 'CUSTOMER_MISMATCH', message: `Subscription subscriber is not the ticket customer ${mandate.customerEmail}` });
  }
  if (!CANCELLABLE.has(subscription.status)) {
    violations.push({ code: 'SUBSCRIPTION_NOT_CANCELLABLE', message: `Subscription status is ${subscription.status || 'unknown'}` });
  }
  if (cancellationsThisTicket >= MAX_CANCELLATIONS_PER_TICKET) {
    violations.push({ code: 'CANCELLATION_LIMIT', message: `A ticket may cancel at most ${MAX_CANCELLATIONS_PER_TICKET} subscription` });
  }
  return violations.length ? { verdict: 'block', violations } : { verdict: 'allow', violations: [] };
}
