// The geometry of the "Flow through the guard" widget (./guard-flow.tsx): the agents at the left,
// what the guard did at the right, and a band from each agent to each verdict, as thick as the
// calls it carries. Both columns use one scale, so the bands leaving an agent add up to its node
// and the bands reaching a verdict add up to that one. Pure, so it is tested without a browser.

export type FlowRow = { agent: string; passed: number; held: number; stopped: number };
export type Verdict = 'passed' | 'held' | 'stopped';

export const VERDICTS: Verdict[] = ['passed', 'held', 'stopped'];

export type FlowNode<K> = { y: number; height: number; total: number } & K;
export type Ribbon = { agent: string; verdict: Verdict; value: number; thickness: number; path: string };

export type Flow = {
  agents: FlowNode<{ name: string }>[];
  verdicts: FlowNode<{ key: Verdict }>[];
  ribbons: Ribbon[];
  // The width of a node, at x 0 (agents) and at width - NODE (verdicts).
  node: number;
};

const NODE = 8;
const GAP = 14;

const round = (n: number) => Math.round(n * 10) / 10;

// Stacks nodes top to bottom with GAP between them, `scale` pixels per call.
function stack<K>(items: (K & { total: number })[], scale: number): FlowNode<K>[] {
  let y = 0;
  return items.map((item) => {
    const node = { ...item, y, height: item.total * scale };
    y += node.height + GAP;
    return node;
  });
}

export function flowLayout(rows: FlowRow[], { width, height }: { width: number; height: number }): Flow {
  // Agents whose calls mostly pass at the top, next to "passed", and those mostly stopped at the
  // bottom, next to "stopped": the bands then cross as little as they can.
  const share = (r: FlowRow) => r.passed / (r.passed + r.held + r.stopped);
  const agentRows = rows.filter((r) => r.passed + r.held + r.stopped > 0).sort((a, b) => share(b) - share(a));
  const total = agentRows.reduce((sum, r) => sum + r.passed + r.held + r.stopped, 0);
  if (total === 0) return { agents: [], verdicts: [], ribbons: [], node: NODE };

  const verdictTotals = VERDICTS.map((key) => ({ key, total: agentRows.reduce((sum, r) => sum + r[key], 0) })).filter((v) => v.total > 0);
  const gaps = Math.max(agentRows.length, verdictTotals.length) - 1;
  const scale = Math.max(0, height - gaps * GAP) / total;

  const agents = stack(
    agentRows.map((r) => ({ name: r.agent, total: r.passed + r.held + r.stopped })),
    scale,
  );
  const verdicts = stack(verdictTotals, scale);

  // Where the next band leaves each agent and reaches each verdict: bands stack inside a node in
  // verdict order on the left and agent order on the right, so they never cross inside a node.
  const leaving = new Map(agents.map((a) => [a.name, a.y]));
  const reaching = new Map(verdicts.map((v) => [v.key, v.y]));
  const x0 = NODE;
  const x1 = width - NODE;
  const bend = (x1 - x0) / 2;

  const ribbons: Ribbon[] = [];
  for (const row of agentRows) {
    for (const verdict of VERDICTS) {
      const value = row[verdict];
      if (value <= 0) continue;
      const thickness = value * scale;
      const y0 = leaving.get(row.agent)!;
      const y1 = reaching.get(verdict)!;
      leaving.set(row.agent, y0 + thickness);
      reaching.set(verdict, y1 + thickness);
      // A band: down the top edge to the verdict, back along the bottom edge to the agent.
      const path = [
        `M${round(x0)} ${round(y0)}`,
        `C${round(x0 + bend)} ${round(y0)} ${round(x1 - bend)} ${round(y1)} ${round(x1)} ${round(y1)}`,
        `L${round(x1)} ${round(y1 + thickness)}`,
        `C${round(x1 - bend)} ${round(y1 + thickness)} ${round(x0 + bend)} ${round(y0 + thickness)} ${round(x0)} ${round(y0 + thickness)}`,
        'Z',
      ].join('');
      ribbons.push({ agent: row.agent, verdict, value, thickness, path });
    }
  }
  // Thickest first: drawn in this order, thin bands land on top and stay visible.
  ribbons.sort((a, b) => b.value - a.value);
  return { agents, verdicts, ribbons, node: NODE };
}

// Label centres, top to bottom, moved apart so no two are closer than `gap` (small nodes sit close
// together): each is pushed below the one above it, then the stack is pulled back up if it ran
// past `height`.
export function spreadLabels(centres: number[], gap: number, height: number): number[] {
  const out = [...centres];
  for (let i = 1; i < out.length; i++) out[i] = Math.max(out[i], out[i - 1] + gap);
  const overflow = out.length ? out[out.length - 1] - height : 0;
  if (overflow > 0) {
    out[out.length - 1] = height;
    for (let i = out.length - 2; i >= 0; i--) out[i] = Math.min(out[i], out[i + 1] - gap);
  }
  return out;
}
