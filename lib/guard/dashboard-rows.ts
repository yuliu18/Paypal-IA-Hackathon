// The guard's audit log as flat tables for the AG Studio dashboard: one row per decision and one
// per violation. Amounts are in major units, like the PayPal tables beside them.

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
  // A blocked refund's requested amount: money the guard kept from leaving the account.
  protected: number | null;
  // 1 while a held refund waits for a person, so the dashboard can sum it.
  awaitingApproval: number;
  decidedBy: 'guard' | 'person';
};

export type GuardViolationRow = { id: string; decisionId: string; code: string; message: string };

export type GuardDashboardRows = { guardDecisions: GuardDecisionRow[]; guardViolations: GuardViolationRow[] };

function requestedAmount(entry: AuditRow) {
  if (entry.tool !== 'create_refund') return null;
  const amount = entry.args.amount as { value?: unknown; currency_code?: unknown } | undefined;
  const value = Number(amount?.value);
  if (amount?.value === undefined || !Number.isFinite(value)) return null;
  return { value, currency: typeof amount.currency_code === 'string' ? amount.currency_code : null };
}

export function guardDashboardRows(entries: AuditRow[]): GuardDashboardRows {
  const decided = new Set(entries.flatMap((e) => (e.resolves ? [e.resolves] : [])));
  return {
    guardDecisions: entries.map((e) => {
      const requested = requestedAmount(e);
      const blocked = e.decision.verdict === 'block';
      return {
        id: e.id,
        at: e.at,
        day: e.at.slice(0, 10),
        tool: e.tool,
        verdict: e.decision.verdict,
        outcome: e.outcome,
        customer: e.task.mandate.customerEmail,
        currency: e.moved?.currency ?? requested?.currency ?? null,
        requested: requested?.value ?? null,
        moved: e.moved ? e.moved.minor / 100 : 0,
        protected: e.tool !== 'create_refund' || !blocked ? 0 : (requested?.value ?? null),
        awaitingApproval: e.outcome === 'held' && !decided.has(e.id) ? 1 : 0,
        decidedBy: e.resolves ? 'person' : 'guard',
      };
    }),
    guardViolations: entries.flatMap((e) =>
      e.decision.violations.map((v, i) => ({ id: `${e.id}-${i}`, decisionId: e.id, code: v.code, message: v.message })),
    ),
  };
}
