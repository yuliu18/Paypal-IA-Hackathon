import { describe, expect, it } from 'vitest';
import type { GuardDecisionRow } from '@/lib/guard/dashboard-rows';
import { AGENTS, controlRoomCounters } from './counters';

type Row = Pick<GuardDecisionRow, 'at' | 'moved' | 'protected' | 'billed' | 'awaitingApproval' | 'blocked'>;

const row = (overrides: Partial<Row> = {}): Row => ({
  at: '2026-10-21T10:00:00.000Z',
  moved: 0,
  protected: 0,
  billed: 0,
  awaitingApproval: 0,
  blocked: 0,
  ...overrides,
});

describe('controlRoomCounters', () => {
  it('adds up the money the guard protected, let move and the billing agent billed, to the cent', () => {
    const counters = controlRoomCounters([
      row({ moved: 10.1, protected: 0.2 }),
      row({ moved: 20.2, protected: 0.1, billed: 99.99 }),
      row({ billed: 0.01 }),
    ]);
    expect(counters).toMatchObject({ protected: 0.3, moved: 30.3, billed: 100 });
  });

  it('counts a blocked refund without a stated amount as nothing protected rather than failing', () => {
    expect(controlRoomCounters([row({ protected: null, blocked: 1 })]).protected).toBe(0);
  });

  it('counts the decisions, the blocks and the held actions still waiting for a person', () => {
    const counters = controlRoomCounters([row({ blocked: 1 }), row({ awaitingApproval: 1 }), row()]);
    expect(counters).toMatchObject({ decisions: 3, blocked: 1, awaiting: 1 });
  });

  it('knows the newest decision whatever order the rows come in, and none without rows', () => {
    const rows = [row({ at: '2026-10-21T10:00:00.000Z' }), row({ at: '2026-10-25T08:30:00.000Z' }), row({ at: '2026-10-22T00:00:00.000Z' })];
    expect(controlRoomCounters(rows).lastDecisionAt).toBe('2026-10-25T08:30:00.000Z');
    expect(controlRoomCounters([])).toEqual({ protected: 0, moved: 0, billed: 0, decisions: 0, blocked: 0, awaiting: 0, lastDecisionAt: null });
  });

  it('lists the two AI agents the guard watches', () => {
    expect(AGENTS.map((a) => a.id)).toEqual(['support', 'billing']);
  });
});
