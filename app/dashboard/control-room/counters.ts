// The control-room header's figures, from the same guard rows the AG Studio report reads
// (lib/guard/dashboard-rows.ts): no other source, so the header and the charts below always agree.

import type { GuardDecisionRow } from '@/lib/guard/dashboard-rows';

// The AI agents the payment guard watches, in the order the header lists them.
export const AGENTS = [
  { id: 'support', name: 'Support', does: 'refunds, disputes, cancellations' },
  { id: 'billing', name: 'Billing', does: 'invoices and reminders' },
] as const;

export type ControlRoomCounters = {
  protected: number;
  moved: number;
  billed: number;
  decisions: number;
  blocked: number;
  awaiting: number;
  lastDecisionAt: string | null;
};

type CountedRow = Pick<GuardDecisionRow, 'at' | 'moved' | 'protected' | 'billed' | 'awaitingApproval' | 'blocked'>;

// Money is added in cents, so 0.1 + 0.2 reads 0.30 and not 0.30000000000000004.
const cents = (amount: number | null) => Math.round((amount ?? 0) * 100);

export function controlRoomCounters(rows: CountedRow[]): ControlRoomCounters {
  let protectedCents = 0;
  let movedCents = 0;
  let billedCents = 0;
  let blocked = 0;
  let awaiting = 0;
  let lastDecisionAt: string | null = null;
  for (const row of rows) {
    protectedCents += cents(row.protected);
    movedCents += cents(row.moved);
    billedCents += cents(row.billed);
    blocked += row.blocked;
    awaiting += row.awaitingApproval;
    // ISO timestamps sort as text.
    if (lastDecisionAt === null || row.at > lastDecisionAt) lastDecisionAt = row.at;
  }
  return {
    protected: protectedCents / 100,
    moved: movedCents / 100,
    billed: billedCents / 100,
    decisions: rows.length,
    blocked,
    awaiting,
    lastDecisionAt,
  };
}
