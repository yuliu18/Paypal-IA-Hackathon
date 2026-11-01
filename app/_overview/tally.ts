// The home page's sentence and verdict strip, from the guard rows the dashboard's AG Studio report
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

// The home page's messages under `tally` (messages/<locale>/home.json), as next-intl's translator
// reads them: getTranslations('home.tally') on the page, createTranslator in the tests.
export type Translate = (key: string, values?: Record<string, string | number>) => string;

// The verdicts in the strip's order.
const OUTCOMES = ['allowed', 'held', 'blocked'] as const;

function list(t: Translate, parts: string[]): string {
  if (parts.length === 3) return t('listThree', { first: parts[0], second: parts[1], third: parts[2] });
  if (parts.length === 2) return t('listTwo', { first: parts[0], second: parts[1] });
  return parts.join('');
}

export function heroSentence(tally: VerdictTally, t: Translate): string {
  if (tally.calls === 0) return t('none');
  const opening = t('opening', { calls: tally.calls });
  const happened = OUTCOMES.filter((key) => tally[key] > 0);
  // One verdict for every call: say it once instead of repeating the total.
  if (happened.length === 1) return t(`onlyOutcome.${happened[0]}`, { opening, calls: tally.calls });
  return t('mixed', { opening, outcomes: list(t, happened.map((key) => t(`outcome.${key}`, { count: tally[key] }))) });
}

export type VerdictShares = { allowed: number; held: number; blocked: number };

// Whole percentages for the strip's three segments, adding up to exactly 100: each is rounded
// down and the points left over go to the largest fractions (largest remainder). A verdict that
// happened at all keeps at least 1%, taken from the widest segment, so it never disappears.
export function verdictShares(tally: VerdictTally): VerdictShares {
  const total = tally.allowed + tally.held + tally.blocked;
  const shares: VerdictShares = { allowed: 0, held: 0, blocked: 0 };
  if (total === 0) return shares;
  const keys = OUTCOMES;
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
