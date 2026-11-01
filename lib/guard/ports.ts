// Ports of the payment guard: what the core needs from the outside world. Adapters for
// PayPal, the LLM provider and storage implement these, so each can be swapped freely.

import type { SubscriptionFacts } from './domain/cancellation';
import type { DisputeFacts } from './domain/dispute';
import type { InvoiceFacts } from './domain/invoice';
import type { CaptureFacts, Decision, Money, TaskMandate } from './domain/policy';

// The task the agent is working on, as the business framed it. `untrustedInput` is what an
// outsider wrote (e.g. the customer's email) and must never be treated as instructions.
export type AgentTask = {
  mandate: TaskMandate;
  instructions: string;
  untrustedInput: string;
};

export type ToolCall = { tool: string; args: Record<string, unknown> };

export interface IntentJudge {
  judge(input: { task: AgentTask; call: ToolCall }): Promise<Decision>;
}

export interface CaptureLookup {
  getCapture(captureId: string): Promise<CaptureFacts>;
}

// Undefined when PayPal knows no such subscription.
export interface SubscriptionLookup {
  getSubscription(subscriptionId: string): Promise<SubscriptionFacts | undefined>;
}

// Undefined when PayPal knows no such dispute.
export interface DisputeLookup {
  getDispute(disputeId: string): Promise<DisputeFacts | undefined>;
}

// Undefined when PayPal knows no such invoice.
export interface InvoiceLookup {
  getInvoice(invoiceId: string): Promise<InvoiceFacts | undefined>;
}

// The shop's existing customers: an invoice only bills someone the shop already sells to.
export interface CustomerDirectory {
  isCustomer(email: string): Promise<boolean>;
}

// Records a new PayPal order as the task customer's (its custom_id), so the owner checks of later
// reads and refunds recognize it. Rejects when PayPal doesn't confirm it.
export interface OrderBinder {
  bindToCustomer(orderId: string, customerEmail: string): Promise<void>;
}

// The PayPal environment a guard decision ran against: the sandbox (test money) or live (real money).
export type PaymentEnvironment = 'sandbox' | 'live';

export type AuditEntry = {
  at: string;
  tool: string;
  args: Record<string, unknown>;
  task: AgentTask;
  decision: Decision;
  // Amount that moved or may have moved: set before execution and cleared only when PayPal
  // explicitly rejects the call, so ambiguous failures still count toward limits.
  moved?: Money;
  // `held` waits for a person and moved nothing.
  outcome: 'pending' | 'executed' | 'blocked' | 'held' | 'error';
  detail?: string;
  // The held entry this one decides (a person's approval or rejection).
  resolves?: string;
  // Recorded with every decision; 'sandbox' when not given. Entries logged before it was recorded
  // read back as 'sandbox'.
  environment?: PaymentEnvironment;
};

export type AuditRow = AuditEntry & { id: string };

export interface AuditLog {
  // Returns the entry id. Writes are logged as `pending` before they run (write-ahead).
  record(entry: AuditEntry): Promise<string>;
  update(id: string, patch: Partial<Pick<AuditEntry, 'outcome' | 'moved' | 'detail'>>): Promise<void>;
  // Money refunded (refunds and dispute acceptances); invoices bill money in and orders move none,
  // so they don't count.
  movedSince(since: Date, currency: string): Promise<Money>;
  // What create_invoice billed, counted the same way (pending and ambiguous failures included).
  billedSince(since: Date, currency: string): Promise<Money>;
  // Whether a refund of this capture may have moved money but never settled (pending, or failed
  // with its amount still counting), so a retry could refund twice.
  hasUnsettledRefund(captureId: string): Promise<boolean>;
  get(id: string): Promise<AuditRow | undefined>;
  // Whether a later entry already decides this held entry.
  isResolved(id: string): Promise<boolean>;
  // The customer an executed create_order was bound to (its audit detail is boundOrderDetail), or
  // undefined when the guard created and bound no such order. The shop captures only those.
  // `environment`: only an order created in that PayPal environment counts (entries logged before
  // the environment was recorded count as sandbox); any environment when not given.
  boundOrderCustomer(orderId: string, environment?: PaymentEnvironment): Promise<string | undefined>;
}

export type ChainCheck =
  | { intact: true; records: number; head: string | null }
  | { intact: false; brokenAt: string; reason: string };

// The audit log as the app's pages read it: the guard's AuditLog plus the newest entries and the
// hash-chain check. Async because the Postgres store is.
export interface BlackBox extends AuditLog {
  // Newest first.
  list(limit: number): Promise<AuditRow[]>;
  // reuseFullCheckMs > 0 skips rows a full check already verified within that window, re-checking
  // only rows added since and the last verified row; 0 always checks the whole chain.
  verifyChain(reuseFullCheckMs?: number, now?: number): Promise<ChainCheck>;
}

// Tells a person that a held entry waits for their decision. The guard doesn't wait for it, and a
// failure to notify never changes what the guard decided.
export interface HeldNotifier {
  notifyHeld(entry: AuditRow): Promise<void>;
}
