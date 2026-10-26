// The guard's audit log as flat tables for the AG Studio dashboard: one row per decision and one
// per violation. Amounts are in major units, like the PayPal tables beside them; emails are masked.

import { withheldCount } from './domain/privacy';
import { maskEmail, maskPersonalData } from './domain/redact';
import type { AuditRow } from './ports';

export type GuardDecisionRow = {
  id: string;
  at: string;
  day: string;
  tool: string;
  verdict: string;
  outcome: string;
  customer: string;
  currency: string | null;
  // What the agent asked to refund; null when it asked for the full remaining amount without stating it.
  requested: number | null;
  moved: number;
  // A blocked refund's requested amount, or a blocked dispute acceptance's recorded amount: money
  // the guard kept from leaving the account.
  protected: number | null;
  // 1 while a held refund waits for a person, so the dashboard can sum it.
  awaitingApproval: number;
  // Personal data fields of a PayPal answer the guard kept from the agent (lib/guard/domain/privacy.ts).
  withheld: number;
  decidedBy: 'guard' | 'person';
  // Which AI agent made the call: the billing agent works with invoices, the support agent with the rest.
  agent: 'support' | 'billing';
  // What kind of action the call was, in words a person reads on the dashboard.
  action: string;
  // An executed invoice's total: money billed to a customer, which has not been paid yet.
  billed: number;
  // 1 under the decision's verdict and 0 under the others, so a chart can stack them as measures in a
  // fixed order (and so in fixed colours: allowed green, held amber, blocked red).
  allowed: number;
  held: number;
  blocked: number;
};

// `reason` is the rule's code in words: 'CUSTOMER_MISMATCH' -> 'Customer mismatch'.
export type GuardViolationRow = { id: string; decisionId: string; code: string; reason: string; message: string };

export type GuardDashboardRows = { guardDecisions: GuardDecisionRow[]; guardViolations: GuardViolationRow[] };

const BILLING_TOOLS = new Set(['create_invoice', 'send_invoice', 'send_invoice_reminder', 'get_invoice']);

const ACTIONS: Record<string, string> = {
  create_refund: 'refund',
  accept_dispute_claim: 'dispute acceptance',
  cancel_subscription: 'cancellation',
  create_invoice: 'invoice',
  send_invoice: 'invoice sending',
  send_invoice_reminder: 'reminder',
  get_order: 'read',
  show_subscription_details: 'read',
  get_dispute: 'read',
  get_invoice: 'read',
};

const reasonOf = (code: string) => code.charAt(0) + code.slice(1).toLowerCase().replaceAll('_', ' ');

const major = (entry: AuditRow) => (entry.moved ? entry.moved.minor / 100 : 0);

// Money a block kept in the account: a refund's stated amount (null when it stated none), or a
// dispute acceptance's recorded amount. The guard records no amount on a blocked entry today, and a
// dispute's amount isn't in its args, so a blocked acceptance usually counts 0 rather than a guess.
function protectedAmount(entry: AuditRow, requested: number | null) {
  if (entry.decision.verdict !== 'block') return 0;
  if (entry.tool === 'create_refund') return requested;
  if (entry.tool === 'accept_dispute_claim') return major(entry);
  return 0;
}

function requestedAmount(entry: AuditRow) {
  if (entry.tool !== 'create_refund') return null;
  const amount = entry.args.amount as { value?: unknown; currency_code?: unknown } | undefined;
  // Only a stated amount counts: Number() would read null and blank strings as 0.
  const stated = typeof amount?.value === 'number' || (typeof amount?.value === 'string' && amount.value.trim() !== '');
  const value = Number(amount?.value);
  if (!stated || !Number.isFinite(value)) return null;
  return { value, currency: typeof amount?.currency_code === 'string' ? amount.currency_code : null };
}

// The newest `limit` entries as rows; an unreadable log leaves the guard page empty instead of
// taking the PayPal pages of the dashboard down with it.
export function readGuardDashboardRows(list: (limit: number) => AuditRow[], limit: number): GuardDashboardRows {
  try {
    return guardDashboardRows(list(limit));
  } catch (error) {
    console.error('Payment guard log could not be read for the dashboard', error);
    return { guardDecisions: [], guardViolations: [] };
  }
}

export function guardDashboardRows(entries: AuditRow[]): GuardDashboardRows {
  const decided = new Set(entries.map((e) => e.resolves).filter((id) => id !== undefined));
  return {
    guardDecisions: entries.map((e) => {
      const requested = requestedAmount(e);
      return {
        id: e.id,
        at: e.at,
        day: e.at.slice(0, 10),
        tool: e.tool,
        verdict: e.decision.verdict,
        outcome: e.outcome,
        customer: maskEmail(e.task.mandate.customerEmail),
        currency: e.moved?.currency ?? requested?.currency ?? null,
        requested: requested?.value ?? null,
        // An invoice records what it bills, not money that left the shop.
        moved: e.tool !== 'create_invoice' ? major(e) : 0,
        protected: protectedAmount(e, requested?.value ?? null),
        awaitingApproval: e.outcome === 'held' && !decided.has(e.id) ? 1 : 0,
        withheld: withheldCount(e.detail),
        decidedBy: e.resolves ? 'person' : 'guard',
        agent: BILLING_TOOLS.has(e.tool) ? 'billing' : 'support',
        action: ACTIONS[e.tool] ?? 'other',
        billed: e.tool === 'create_invoice' && e.outcome === 'executed' ? major(e) : 0,
        allowed: e.decision.verdict === 'allow' ? 1 : 0,
        held: e.decision.verdict === 'hold' ? 1 : 0,
        blocked: e.decision.verdict === 'block' ? 1 : 0,
      };
    }),
    guardViolations: entries.flatMap((e) =>
      e.decision.violations.map((v, i) => ({ id: `${e.id}-${i}`, decisionId: e.id, code: v.code, reason: reasonOf(v.code), message: maskPersonalData(v.message) })),
    ),
  };
}
