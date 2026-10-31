// The home page's checkpoint: the guard's newest decisions on calls that would change something at
// PayPal (refunds, invoices, orders…), from the same rows the dashboard reads
// (lib/guard/dashboard-rows.ts), so emails are already masked. Reads and a person's approvals are
// left out: they are not an agent trying to move money.

import type { GuardDashboardRows } from '@/lib/guard/dashboard-rows';
import type { AuditEntry } from '@/lib/guard/ports';

export type CheckpointCall = {
  id: string;
  at: string;
  agent: string;
  action: string;
  amount: string | null;
  customer: string;
  outcome: AuditEntry['outcome'];
  // The first rule the call broke, in words; null when it passed.
  reason: string | null;
};

const capitalize = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

export function checkpointCalls({ guardDecisions, guardViolations }: GuardDashboardRows, limit: number): CheckpointCall[] {
  const firstReason = new Map<string, string>();
  for (const v of guardViolations) if (!firstReason.has(v.decisionId)) firstReason.set(v.decisionId, v.reason);
  return guardDecisions
    .filter((row) => row.decidedBy === 'guard' && row.action !== 'read')
    .slice(0, limit)
    .map((row) => ({
      id: row.id,
      at: row.at,
      agent: capitalize(row.agent),
      action: capitalize(row.action),
      amount: row.requested === null || !row.currency ? null : `${row.requested.toFixed(2)} ${row.currency}`,
      customer: row.customer,
      outcome: row.outcome as AuditEntry['outcome'],
      reason: firstReason.get(row.id) ?? null,
    }));
}

const UNITS = [
  { ms: 86_400_000, one: 'day', many: 'days' },
  { ms: 3_600_000, one: 'h', many: 'h' },
  { ms: 60_000, one: 'min', many: 'min' },
];

export function timeAgo(at: string, now: Date): string {
  const elapsed = now.getTime() - new Date(at).getTime();
  for (const unit of UNITS) {
    const n = Math.floor(elapsed / unit.ms);
    if (n >= 1) return `${n} ${n === 1 ? unit.one : unit.many} ago`;
  }
  return 'just now';
}
