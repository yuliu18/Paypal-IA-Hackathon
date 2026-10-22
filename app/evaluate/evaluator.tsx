'use client';

import { useRef, useState } from 'react';
import type { AgentStep } from '@/lib/agent/support-agent';
import type { EvalResult } from '@/lib/evaluation/evaluation';
import { maskPersonalData } from '@/lib/guard/domain/redact';
import { prepareEvaluationAction, type PreparedCase } from './actions';

type Row = PreparedCase & { status: 'waiting' | 'running' | 'done'; result?: EvalResult; reply?: string; steps?: AgentStep[] };

const pct = (n: number, of: number) => (of ? `${Math.round((n / of) * 100)}%` : '–');

function Score({ label, value, of, detail, tone }: { label: string; value: number; of: number; detail: string; tone: 'good' | 'warn' | 'bad' | 'idle' }) {
  const color = { good: 'text-pp-success', warn: 'text-pp-warning', bad: 'text-pp-danger', idle: 'text-pp-muted' }[tone];
  return (
    <section className="rounded-lg border border-pp-border bg-pp-surface p-5">
      <h2 className="text-xs font-semibold uppercase tracking-wider text-pp-muted">{label}</h2>
      <p className={`mt-2 text-3xl font-semibold ${color}`}>
        {value}/{of} <span className="text-base font-normal text-pp-muted">{pct(value, of)}</span>
      </p>
      <p className="mt-1 text-sm text-pp-muted">{detail}</p>
    </section>
  );
}

const stepStyle = (step: AgentStep) =>
  step.result.startsWith('Blocked by payment guard') ? 'text-pp-danger' : step.result.startsWith('Refund held') ? 'text-pp-warning' : 'text-pp-ink';

function Badge({ row }: { row: Row }) {
  if (row.status === 'waiting') return <span className="text-pp-muted">Waiting</span>;
  if (row.status === 'running') return <span className="text-pp-blue">Running…</span>;
  const r = row.result!;
  if (row.kind === 'business') return <span className={r.pass ? 'text-pp-success' : 'text-pp-danger'}>{r.pass ? 'Resolved' : 'Wrong outcome'}</span>;
  if (!r.guardHeld) return <span className="text-pp-danger">{r.guardHeld === undefined ? 'Failed' : 'Harm got through'}</span>;
  return <span className={r.resisted ? 'text-pp-success' : 'text-pp-warning'}>{r.resisted ? 'Model refused' : 'Guard stopped it'}</span>;
}

// Runs the evaluation one ticket at a time (app/api/evaluate) and fills the scorecard as answers come.
export function Evaluator({ model, provider }: { model: string; provider: string }) {
  const [rows, setRows] = useState<Row[]>([]);
  const [running, setRunning] = useState(false);
  const [message, setMessage] = useState<string>();
  const stop = useRef(false);

  const update = (id: string, change: Partial<Row>) => setRows((current) => current.map((row) => (row.id === id ? { ...row, ...change } : row)));

  async function run() {
    setRunning(true);
    setMessage('Creating fresh sample payments…');
    stop.current = false;
    const prepared = await prepareEvaluationAction();
    if (!prepared.ok) {
      setMessage(prepared.message);
      setRunning(false);
      return;
    }
    setRows(prepared.cases.map((c) => ({ ...c, status: 'waiting' })));
    setMessage(undefined);
    for (const c of prepared.cases) {
      if (stop.current) break;
      update(c.id, { status: 'running' });
      try {
        const res = await fetch('/api/evaluate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ caseId: c.id }) });
        const body = await res.json();
        update(c.id, res.ok ? { status: 'done', result: body.result, reply: body.reply, steps: body.steps } : { status: 'done', result: { pass: false, reason: body.error?.message ?? `Request failed (${res.status})` } });
      } catch (error) {
        update(c.id, { status: 'done', result: { pass: false, reason: error instanceof Error ? error.message : String(error) } });
      }
    }
    setRunning(false);
  }

  const done = rows.filter((r) => r.status === 'done');
  const business = rows.filter((r) => r.kind === 'business');
  const attacks = rows.filter((r) => r.kind === 'attack');
  const resolved = done.filter((r) => r.kind === 'business' && r.result?.pass).length;
  const held = done.filter((r) => r.kind === 'attack' && r.result?.guardHeld).length;
  const refused = done.filter((r) => r.kind === 'attack' && r.result?.resisted).length;
  const finished = rows.length > 0 && done.length === rows.length;
  // The model's own score is never shown as a failure: the guard is what keeps the money safe.
  const tone = (value: number, of: number): 'good' | 'warn' | 'bad' | 'idle' => (!finished ? 'idle' : value === of ? 'good' : value >= of / 2 ? 'warn' : 'bad');

  return (
    <main className="mx-auto w-full max-w-5xl p-8 font-paypal text-pp-ink">
      <p className="text-sm font-semibold text-pp-blue">Before you switch it on</p>
      <h1 className="mt-1 text-[28px] font-semibold text-pp-navy">Evaluate the AI model</h1>
      <p className="mt-2 max-w-3xl text-pp-muted">
        Sends {business.length || 5} tickets your shop expects to work and {attacks.length || 9} attacks to the real support agent behind the payment guard,
        with <strong className="text-pp-ink">{model || 'no model'}</strong> on {provider}. Sandbox money only; the daily cap is lifted for these tickets so
        repeated runs compare alike, every other limit applies. Takes a few minutes and uses AI tokens.
      </p>

      <div className="mt-5 flex items-center gap-4">
        <button
          type="button"
          onClick={run}
          disabled={running || !model}
          className="rounded bg-pp-blue px-5 py-2 font-semibold text-white hover:bg-pp-blue-dark disabled:opacity-60"
        >
          {running ? 'Evaluating…' : rows.length ? 'Run again' : 'Run evaluation'}
        </button>
        {running && (
          <button type="button" onClick={() => (stop.current = true)} className="text-sm font-semibold text-pp-blue hover:underline">
            Stop after this ticket
          </button>
        )}
        {message && <span className="text-sm text-pp-muted">{message}</span>}
        {rows.length > 0 && !message && (
          <span className="text-sm text-pp-muted">
            {done.length}/{rows.length} tickets
          </span>
        )}
      </div>

      <div className="mt-6 grid gap-4 md:grid-cols-3">
        <Score label="Business tickets resolved" value={resolved} of={business.length || 5} detail="Refunds, holds and refusals the policy expects." tone={tone(resolved, business.length)} />
        <Score label="Guard held" value={held} of={attacks.length || 9} detail="Attacks where no money moved and no data leaked." tone={tone(held, attacks.length)} />
        <Score label="Model refused on its own" value={refused} of={attacks.length || 9} detail="Attacks the model rejected before the guard had to act." tone={!finished ? 'idle' : refused === attacks.length ? 'good' : 'warn'} />
      </div>

      {rows.length > 0 && (
        <ol className="mt-8 divide-y divide-pp-border rounded-lg border border-pp-border bg-pp-surface">
          {rows.map((row) => (
            <li key={row.id}>
              <details className="group px-5 py-3">
                <summary className="flex cursor-pointer list-none items-center gap-4 text-sm">
                  <span className={`w-16 shrink-0 text-xs font-semibold uppercase tracking-wider ${row.kind === 'attack' ? 'text-pp-danger' : 'text-pp-blue'}`}>{row.kind}</span>
                  <span className="min-w-0 flex-1 font-semibold text-pp-navy">{row.title}</span>
                  <span className="shrink-0 text-sm font-semibold">
                    <Badge row={row} />
                  </span>
                </summary>
                <div className="mt-3 space-y-2 pl-20 text-sm">
                  <p className="whitespace-pre-wrap text-pp-muted">
                    <strong className="text-pp-ink">Ticket from {maskPersonalData(row.customer)}:</strong> {maskPersonalData(row.message)}
                  </p>
                  {row.result && <p className="text-pp-ink">{row.result.reason}</p>}
                  {row.steps?.map((step, i) => (
                    <p key={i} className={`font-mono text-xs ${stepStyle(step)}`}>
                      {step.tool} {maskPersonalData(JSON.stringify(step.args))} → {maskPersonalData(step.result).slice(0, 220)}
                    </p>
                  ))}
                  {row.reply && (
                    <p className="whitespace-pre-wrap rounded bg-pp-canvas p-3 text-pp-ink">{maskPersonalData(row.reply)}</p>
                  )}
                </div>
              </details>
            </li>
          ))}
        </ol>
      )}
    </main>
  );
}
