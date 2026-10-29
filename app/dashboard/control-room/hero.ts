// The dashboard's opening sentence and its verdict strip, from the guard rows the AG Studio report
// reads (lib/guard/dashboard-rows.ts). Both count the calls the AI agents made; a person's
// approval or rejection of a held call is a decision about that call, not another call.

import type { GuardDecisionRow } from '@/lib/guard/dashboard-rows';

export type VerdictTally = { calls: number; allowed: number; held: number; blocked: number };

type TalliedRow = Pick<GuardDecisionRow, 'decidedBy' | 'allowed' | 'held' | 'blocked'>;

export function agentCalls(rows: TalliedRow[]): VerdictTally {
  const tally = { calls: 0, allowed: 0, held: 0, blocked: 0 };
  for (const row of rows) {
    if (row.decidedBy !== 'guard') continue;
    tally.calls += 1;
    tally.allowed += row.allowed;
    tally.held += row.held;
    tally.blocked += row.blocked;
  }
  return tally;
}

const count = (n: number) => n.toLocaleString('en-US');

// What happened to the calls of each verdict, in the strip's order.
const OUTCOMES = [
  { key: 'allowed', one: 'went through', many: 'went through' },
  { key: 'held', one: 'was held for you', many: 'were held for you' },
  { key: 'blocked', one: 'was stopped', many: 'were stopped' },
] as const;

const list = (parts: string[]) => (parts.length < 2 ? parts.join('') : `${parts.slice(0, -1).join(', ')} and ${parts.at(-1)}`);

export function heroSentence(tally: VerdictTally): string {
  if (tally.calls === 0) return "Your agents haven't made a PayPal call yet.";
  const opening = `Your agents made ${count(tally.calls)} PayPal ${tally.calls === 1 ? 'call' : 'calls'}`;
  const happened = OUTCOMES.filter((o) => tally[o.key] > 0);
  // One verdict for every call: say it once instead of repeating the total.
  if (happened.length === 1) {
    const [only] = happened;
    return tally.calls === 1 ? `${opening} and it ${only.one}.` : `${opening} and all of them ${only.many}.`;
  }
  return `${opening}. ${list(happened.map((o) => `${count(tally[o.key])} ${tally[o.key] === 1 ? o.one : o.many}`))}.`;
}

export type VerdictShares = { allowed: number; held: number; blocked: number };

// Whole percentages for the strip's three segments, adding up to exactly 100: each is rounded
// down and the points left over go to the largest fractions (largest remainder). A verdict that
// happened at all keeps at least 1%, taken from the widest segment, so it never disappears.
export function verdictShares(tally: VerdictTally): VerdictShares {
  const total = tally.allowed + tally.held + tally.blocked;
  const shares: VerdictShares = { allowed: 0, held: 0, blocked: 0 };
  if (total === 0) return shares;
  const keys = OUTCOMES.map((o) => o.key);
  const exact = keys.map((key) => (tally[key] / total) * 100);
  keys.forEach((key, i) => (shares[key] = Math.floor(exact[i])));
  let left = 100 - keys.reduce((sum, key) => sum + shares[key], 0);
  const byRemainder = keys.map((key, i) => ({ key, remainder: exact[i] - shares[key] })).sort((a, b) => b.remainder - a.remainder);
  for (const { key } of byRemainder) {
    if (left === 0) break;
    shares[key] += 1;
    left -= 1;
  }
  for (const key of keys) {
    if (tally[key] > 0 && shares[key] === 0) {
      const widest = keys.reduce((a, b) => (shares[b] > shares[a] ? b : a));
      shares[widest] -= 1;
      shares[key] = 1;
    }
  }
  return shares;
}
