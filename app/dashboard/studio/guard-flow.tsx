'use client';

// "Flow through the guard": a custom AG Studio widget (registered in ./widgets.ts) that draws every
// call of the shop's AI agents passing the payment guard, as bands from each agent to what the guard
// did: passed to PayPal, held for a person, stopped. A band is as thick as its calls. It reads its
// rows through Studio (widgetApi.getData), so page filters and other widgets' cross-filters apply,
// and clicking an agent cross-filters the rest of the page by that agent.

import { useEffect, useMemo, useRef, useState } from 'react';
import type { AgWidgetField, AgWidgetParams } from 'ag-studio';
import { flowLayout, VERDICTS, type FlowRow, type Verdict } from './guard-flow-layout';

const VERDICT_LABEL: Record<Verdict, string> = { passed: 'Passed to PayPal', held: 'Held for you', stopped: 'Stopped by the guard' };
const VERDICT_COLOR: Record<Verdict, string> = { passed: 'var(--pp-series-1)', held: 'var(--pp-series-2)', stopped: 'var(--pp-series-3)' };

// Room for the labels beside the two columns of nodes, and above the drawing for the gate's name.
const LEFT = 132;
const RIGHT = 178;
const TOP = 26;
// Room under the drawing for the gate's foot.
const BOTTOM = 10;

const capitalize = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);
const count = (n: number) => n.toLocaleString('en-US');
const percent = (n: number, of: number) => `${Math.round((n / of) * 100)}%`;

function useSize() {
  const ref = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => setSize({ width: entry.contentRect.width, height: entry.contentRect.height }));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  return [ref, size] as const;
}

type Mapping = { categoryKey?: AgWidgetField[]; valueKey?: AgWidgetField[] };

export function GuardFlowWidget(params: AgWidgetParams) {
  const { widgetApi, format } = params;
  const mapping = params.dataMapping as Mapping;
  const agentField = mapping.categoryKey?.[0];
  const valueFields = useMemo(() => mapping.valueKey ?? [], [mapping.valueKey]);
  const [rows, setRows] = useState<FlowRow[]>([]);
  const [hovered, setHovered] = useState<string>();
  const [selected, setSelected] = useState<string>();
  const [ref, size] = useSize();

  useEffect(() => {
    if (!agentField || valueFields.length < VERDICTS.length) {
      widgetApi.setDisplayState('incompleteDataMapping');
      return;
    }
    const controller = new AbortController();
    widgetApi.setDisplayState('loading');
    widgetApi
      .getData({ fields: [agentField, ...valueFields] }, { signal: controller.signal })
      .then(({ results }) => {
        // The value fields in mapping order are the verdicts in order: passed, held, stopped.
        const flow = results.rows.map((row) => ({
          agent: String(row[agentField.key] ?? ''),
          passed: Number(row[valueFields[0].key] ?? 0),
          held: Number(row[valueFields[1].key] ?? 0),
          stopped: Number(row[valueFields[2].key] ?? 0),
        }));
        setRows(flow);
        widgetApi.setDisplayState(flow.some((r) => r.passed + r.held + r.stopped > 0) ? 'displayed' : 'noData');
      })
      .catch((error) => {
        if (!controller.signal.aborted) console.error('Flow through the guard could not read its data', error);
      });
    return () => controller.abort();
  }, [widgetApi, agentField, valueFields]);

  const plot = { width: Math.max(0, size.width - LEFT - RIGHT), height: Math.max(0, size.height - TOP - BOTTOM) };
  const flow = useMemo(() => flowLayout(rows, plot), [rows, plot.width, plot.height]); // eslint-disable-line react-hooks/exhaustive-deps
  const total = flow.agents.reduce((sum, a) => sum + a.total, 0);
  const gateX = LEFT + plot.width / 2;
  const crossFilter = (format as { crossFilter?: string } | undefined)?.crossFilter;

  function choose(agent: string) {
    if (!agentField || !crossFilter || crossFilter === 'none') return;
    const next = selected === agent ? undefined : agent;
    widgetApi.toggleCrossFilter({ type: 'value', field: agentField, value: agent, group: 0, reset: next === undefined });
    setSelected(next);
  }

  // A band is lit when nothing is pointed at or chosen, or when it belongs to what is.
  const focus = hovered ?? selected;
  const lit = (agent: string) => !focus || focus === agent;

  return (
    <div ref={ref} className="relative h-full w-full font-paypal text-pp-ink" role="img" aria-label={describe(flow, total)}>
      {size.width > 0 && total > 0 && (
        <svg width={size.width} height={size.height} className="block overflow-visible">
          <g transform={`translate(${LEFT} ${TOP})`}>
            {flow.ribbons.map((ribbon) => (
              <path
                key={`${ribbon.agent}-${ribbon.verdict}`}
                d={ribbon.path}
                fill={VERDICT_COLOR[ribbon.verdict]}
                fillOpacity={lit(ribbon.agent) ? 0.42 : 0.1}
                className="transition-[fill-opacity] duration-150"
              >
                <title>{`${capitalize(ribbon.agent)} agent: ${count(ribbon.value)} ${ribbon.value === 1 ? 'call' : 'calls'} ${VERDICT_LABEL[ribbon.verdict].toLowerCase()}`}</title>
              </path>
            ))}
            {flow.agents.map((agent) => (
              <rect key={agent.name} x={0} y={agent.y} width={flow.node} height={Math.max(agent.height, 1)} rx={2} fill="var(--pp-ink)" opacity={lit(agent.name) ? 1 : 0.3} />
            ))}
            {flow.verdicts.map((verdict) => (
              <rect key={verdict.key} x={plot.width - flow.node} y={verdict.y} width={flow.node} height={Math.max(verdict.height, 1)} rx={2} fill={VERDICT_COLOR[verdict.key]} />
            ))}
          </g>
          {/* The guard: the gate every band passes, as in the app's mark. */}
          <rect x={gateX - 3} y={TOP - 6} width={6} height={plot.height + 12} rx={3} fill="var(--pp-ink)" />
          <text x={gateX} y={12} textAnchor="middle" className="fill-pp-ink text-[12px] font-semibold">
            Payment guard
          </text>
        </svg>
      )}

      {/* Labels as HTML beside the drawing, so they wrap and take clicks. */}
      {flow.agents.map((agent) => (
        <button
          key={agent.name}
          type="button"
          onClick={() => choose(agent.name)}
          onMouseEnter={() => setHovered(agent.name)}
          onMouseLeave={() => setHovered(undefined)}
          aria-pressed={selected === agent.name}
          className={`absolute left-0 flex w-[124px] -translate-y-1/2 flex-col items-end rounded px-1 text-right ${lit(agent.name) ? '' : 'opacity-40'}`}
          style={{ top: TOP + agent.y + agent.height / 2 }}
        >
          <span className="text-sm font-semibold">{capitalize(agent.name)} agent</span>
          <span className="text-xs text-pp-muted">{count(agent.total)} calls</span>
        </button>
      ))}
      {flow.verdicts.map((verdict) => (
        <div key={verdict.key} className="absolute right-0 w-[170px] -translate-y-1/2 pl-2" style={{ top: TOP + verdict.y + verdict.height / 2 }}>
          <p className="text-sm font-semibold">{VERDICT_LABEL[verdict.key]}</p>
          <p className="text-xs text-pp-muted">
            {count(verdict.total)} calls, {percent(verdict.total, total)}
          </p>
        </div>
      ))}
    </div>
  );
}

// The drawing in words, for screen readers.
function describe(flow: ReturnType<typeof flowLayout>, total: number): string {
  if (total === 0) return 'No calls yet.';
  return flow.verdicts.map((v) => `${count(v.total)} ${VERDICT_LABEL[v.key].toLowerCase()}`).join(', ');
}
