import { describe, expect, it } from 'vitest';
import { flowLayout } from './guard-flow-layout';

const rows = [
  { agent: 'support', passed: 300, held: 20, stopped: 180 },
  { agent: 'billing', passed: 150, held: 30, stopped: 20 },
  { agent: 'sales', passed: 80, held: 3, stopped: 581 },
];
const size = { width: 900, height: 360 };

describe('flowLayout', () => {
  it('draws one node per agent and per verdict, each as tall as its share of the calls', () => {
    const { agents, verdicts } = flowLayout(rows, size);
    expect(agents.map((a) => [a.name, a.total])).toEqual([
      ['support', 500],
      ['billing', 200],
      ['sales', 664],
    ]);
    expect(verdicts.map((v) => [v.key, v.total])).toEqual([
      ['passed', 530],
      ['held', 53],
      ['stopped', 781],
    ]);
    // The same calls on both sides, at the same scale.
    const scale = agents[0].height / 500;
    expect(agents[2].height / 664).toBeCloseTo(scale);
    expect(verdicts[2].height / 781).toBeCloseTo(scale);
  });

  it('keeps every node inside the drawing, in order, with a gap between them', () => {
    const { agents, verdicts } = flowLayout(rows, size);
    for (const column of [agents, verdicts]) {
      expect(column[0].y).toBeGreaterThanOrEqual(0);
      expect(column.at(-1)!.y + column.at(-1)!.height).toBeLessThanOrEqual(size.height + 0.001);
      for (let i = 1; i < column.length; i++) expect(column[i].y).toBeGreaterThan(column[i - 1].y + column[i - 1].height);
    }
  });

  it('runs one band from each agent to each verdict it had, as thick as those calls', () => {
    const { ribbons, agents } = flowLayout(rows, size);
    expect(ribbons).toHaveLength(9);
    const scale = agents[0].height / 500;
    const salesStopped = ribbons.find((r) => r.agent === 'sales' && r.verdict === 'stopped')!;
    expect(salesStopped.value).toBe(581);
    expect(salesStopped.thickness).toBeCloseTo(581 * scale);
    expect(salesStopped.path).toMatch(/^M[\d.]+ [\d.]+C/);
  });

  it('leaves out bands with no calls and agents that made none', () => {
    const { agents, ribbons } = flowLayout([{ agent: 'sales', passed: 0, held: 0, stopped: 4 }, { agent: 'billing', passed: 0, held: 0, stopped: 0 }], size);
    expect(agents.map((a) => a.name)).toEqual(['sales']);
    expect(ribbons.map((r) => r.verdict)).toEqual(['stopped']);
  });

  it('draws nothing when there are no calls', () => {
    expect(flowLayout([], size)).toMatchObject({ agents: [], verdicts: [], ribbons: [] });
  });
});
