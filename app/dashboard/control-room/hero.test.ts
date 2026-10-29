import { describe, expect, it } from 'vitest';
import type { GuardDecisionRow } from '@/lib/guard/dashboard-rows';
import { agentCalls, heroSentence, verdictShares } from './hero';

type Row = Pick<GuardDecisionRow, 'decidedBy' | 'allowed' | 'held' | 'blocked'>;

const allowed: Row = { decidedBy: 'guard', allowed: 1, held: 0, blocked: 0 };
const held: Row = { decidedBy: 'guard', allowed: 0, held: 1, blocked: 0 };
const blocked: Row = { decidedBy: 'guard', allowed: 0, held: 0, blocked: 1 };

describe('agentCalls', () => {
  it('counts the calls the agents made by verdict, leaving out the decisions a person made on held calls', () => {
    const rows = [allowed, allowed, held, blocked, { decidedBy: 'person', allowed: 1, held: 0, blocked: 0 } as Row, { decidedBy: 'person', allowed: 0, held: 0, blocked: 1 } as Row];
    expect(agentCalls(rows)).toEqual({ calls: 4, allowed: 2, held: 1, blocked: 1 });
  });

  it('counts nothing without rows', () => {
    expect(agentCalls([])).toEqual({ calls: 0, allowed: 0, held: 0, blocked: 0 });
  });
});

describe('heroSentence', () => {
  it('tells the owner what went through, what was held and what was stopped, with thousands separators', () => {
    const tally = { calls: 1090, allowed: 391, held: 35, blocked: 664 };
    expect(heroSentence(tally)).toBe('Your agents made 1,090 PayPal calls. 391 went through, 35 were held for you and 664 were stopped.');
  });

  it('uses the singular for one call of a kind', () => {
    expect(heroSentence({ calls: 3, allowed: 1, held: 1, blocked: 1 })).toBe(
      'Your agents made 3 PayPal calls. 1 went through, 1 was held for you and 1 was stopped.',
    );
  });

  it('leaves out a verdict that never happened', () => {
    expect(heroSentence({ calls: 5, allowed: 2, held: 0, blocked: 3 })).toBe('Your agents made 5 PayPal calls. 2 went through and 3 were stopped.');
  });

  it('says so when every call went through', () => {
    expect(heroSentence({ calls: 12, allowed: 12, held: 0, blocked: 0 })).toBe('Your agents made 12 PayPal calls and all of them went through.');
    expect(heroSentence({ calls: 1, allowed: 1, held: 0, blocked: 0 })).toBe('Your agents made 1 PayPal call and it went through.');
  });

  it('says so when the guard stopped every call', () => {
    expect(heroSentence({ calls: 4, allowed: 0, held: 0, blocked: 4 })).toBe('Your agents made 4 PayPal calls and all of them were stopped.');
    expect(heroSentence({ calls: 1, allowed: 0, held: 0, blocked: 1 })).toBe('Your agents made 1 PayPal call and it was stopped.');
  });

  it('says plainly that nothing happened yet when the agents made no calls', () => {
    expect(heroSentence({ calls: 0, allowed: 0, held: 0, blocked: 0 })).toBe("Your agents haven't made a PayPal call yet.");
  });
});

describe('verdictShares', () => {
  it('splits the strip into whole percentages that always add up to 100', () => {
    const shares = verdictShares({ calls: 1090, allowed: 391, held: 35, blocked: 664 });
    expect(shares).toEqual({ allowed: 36, held: 3, blocked: 61 });
    expect(shares.allowed + shares.held + shares.blocked).toBe(100);
  });

  it('gives the rounding remainder to the largest fractions, so thirds read 34, 33, 33', () => {
    const shares = verdictShares({ calls: 3, allowed: 1, held: 1, blocked: 1 });
    expect(shares.allowed + shares.held + shares.blocked).toBe(100);
    expect([shares.allowed, shares.held, shares.blocked].sort()).toEqual([33, 33, 34]);
  });

  it('gives a verdict that never happened no width', () => {
    expect(verdictShares({ calls: 4, allowed: 1, held: 0, blocked: 3 })).toEqual({ allowed: 25, held: 0, blocked: 75 });
  });

  it('keeps a rare verdict visible at 1% instead of rounding it away', () => {
    const shares = verdictShares({ calls: 1000, allowed: 2, held: 0, blocked: 998 });
    expect(shares).toEqual({ allowed: 1, held: 0, blocked: 99 });
  });

  it('draws no segments without calls', () => {
    expect(verdictShares({ calls: 0, allowed: 0, held: 0, blocked: 0 })).toEqual({ allowed: 0, held: 0, blocked: 0 });
  });
});
