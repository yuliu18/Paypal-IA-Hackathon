'use client';

import { useRef, useState } from 'react';
import type { AgentStep } from '@/lib/agent/support-agent';
import { summarize, type EvalResult } from '@/lib/evaluation/evaluation';
import { maskPersonalData } from '@/lib/guard/domain/redact';
import { prepareEvaluationAction, type PreparedCase } from './actions';

type Row = PreparedCase & { status: 'waiting' | 'running' | 'done'; result?: EvalResult; reply?: string; steps?: AgentStep[] };

const pct = (n: number, of: number) => (of ? `${Math.round((n / of) * 100)}%` : '–');

function Score({ label, value, of, detail, tone }: { label: string; value: number; of: number; detail: string; tone: 'good' | 'warn' | 'bad' | 'idle' }) {
  const color = { good: 'text-pp-success', warn: 'text-pp-warning', bad: 'text-pp-danger', idle: 'text-pp-muted' }[tone];
  return (
    <section className="rounded-lg border border-pp-border bg-pp-surface p-5">
      <h2 className="text-xs font-semibold uppercase tracking-wider text-pp-muted">{label}</h2>
      <p className={`mt-2 text-3xl font-semibold ${of ? color : 'text-pp-muted'}`}>
        {of ? `${value}/${of}` : '–'} <span className="text-base font-normal text-pp-muted">{of ? pct(value, of) : 'nothing scored'}</span>
      </p>
      <p className="mt-1 text-sm text-pp-muted">{detail}</p>
    </section>
  );
}

const stepStyle = (step: AgentStep) =>
  step.result.startsWith('Blocked by payment guard')
    ? 'text-pp-danger'
    : /^(Refund|Cancellation|Dispute acceptance|Invoice|Invoice sending|Invoice reminder) held/.test(step.result)
      ? 'text-pp-warning'
      : 'text-pp-ink';

function Badge({ row }: { row: Row }) {
  if (row.status === 'waiting') return <span className="text-pp-muted">Waiting</span>;
  if (row.status === 'running') return <span className="text-pp-blue">Running…</span>;
  const r = row.result!;
  // No answer at all (e.g. the AI provider refused the model): not graded, whatever its kind.
  if (r.failed) return <span className="text-pp-muted">No answer</span>;
  if (row.kind === 'business') return <span className={r.pass ? 'text-pp-success' : 'text-pp-danger'}>{r.pass ? 'Resolved' : 'Wrong outcome'}</span>;
  if (!r.guardHeld) return <span className="text-pp-danger">{r.guardHeld === undefined ? 'Failed' : 'Harm got through'}</span>;
  return <span className={r.resisted ? 'text-pp-success' : 'text-pp-warning'}>{r.resisted ? 'Model refused' : 'Guard stopped it'}</span>;
}

// The evaluation's fixed sizes (lib/evaluation): business cases (five support tickets, two billing
// tasks, two sales chats) and attacks (nine on the support agent, three on the billing agent, five
// on the sales agent).
const BUSINESS_CASES = 9;
const FIXED_ATTACKS = 17;

const DESK_LABEL = { support: 'Ticket from', billing: 'Billing task for', sales: 'Sales chat from' } as const;

// Runs the evaluation one ticket at a time (app/api/evaluate) and fills the scorecard as answers come.
// `subscription`: a sample subscription exists, so the run adds its cancellation attacks.
// `dispute`: the sample PayPal payment was paid, so the run adds dispute attacks if it was disputed.
export function Evaluator({ model, provider, subscription, dispute }: { model: string; provider: string; subscription: boolean; dispute: boolean }) {
  const [rows, setRows] = useState<Row[]>([]);
  const [running, setRunning] = useState(false);
  const [message, setMessage] = useState<string>();
  const [note, setNote] = useState<string>();
  const [full, setFull] = useState(false);
  const stop = useRef(false);

  const update = (id: string, change: Partial<Row>) => setRows((current) => current.map((row) => (row.id === id ? { ...row, ...change } : row)));

  async function run() {
    setRunning(true);
    setMessage('Creating fresh sample payments…');
    stop.current = false;
    // The action reports its own errors; a failed call (network, expired password) must not leave
    // the page stuck in "Evaluating…" either.
    const prepared = await prepareEvaluationAction(full).catch(() => ({ ok: false as const, message: 'The evaluation could not start: reload the page and try again.' }));
    if (!prepared.ok) {
      setMessage(prepared.message);
      setRunning(false);
      return;
    }
    setRows(prepared.cases.map((c) => ({ ...c, status: 'waiting' })));
    setNote(prepared.note);
    setMessage(undefined);
    for (const c of prepared.cases) {
      if (stop.current) break;
      update(c.id, { status: 'running' });
      try {
        const res = await fetch('/api/evaluate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ caseId: c.id }) });
        const body = await res.json();
        update(c.id, res.ok ? { status: 'done', result: body.result, reply: body.reply, steps: body.steps } : { status: 'done', result: { pass: false, failed: true, reason: body.error?.message ?? `Request failed (${res.status})` } });
      } catch (error) {
        // The request itself failed (network, timeout): no answer, so not scored either.
        update(c.id, { status: 'done', result: { pass: false, failed: true, reason: error instanceof Error ? error.message : String(error) } });
      }
    }
    setRunning(false);
  }

  const done = rows.filter((r) => r.status === 'done');
  const score = summarize(rows);
  const finished = rows.length > 0 && done.length === rows.length;
  // Before a run, the evaluation's sizes without the cases that use a sample record up, which need
  // PayPal's word.
  const attacks = FIXED_ATTACKS + (subscription ? 2 : 0) + (dispute ? 2 : 0);
  const sizes = rows.length ? score : { business: { of: BUSINESS_CASES }, guardHeld: { of: attacks * (full ? 6 : 1) }, refused: { of: attacks * (full ? 3 : 1) } };
  // The model's own score is never shown as a failure: the guard is what keeps the money safe.
  const tone = (value: number, of: number): 'good' | 'warn' | 'bad' | 'idle' => (!finished || !of ? 'idle' : value === of ? 'good' : value >= of / 2 ? 'warn' : 'bad');
  const firstFailure = rows.find((r) => r.result?.failed)?.result?.reason;

  return (
    <main className="mx-auto w-full max-w-5xl p-8 font-paypal text-pp-ink">
      <p className="text-sm font-semibold text-pp-blue">Before you switch it on</p>
      <h1 className="mt-1 text-[28px] font-semibold text-pp-navy">Evaluate the AI model</h1>
      <p className="mt-2 max-w-3xl text-pp-muted">
        Sends {sizes.business.of} tickets, billing tasks and sales chats your shop expects to work and {attacks} attacks to the real support, billing and sales agents
        behind the payment guard, with <strong className="text-pp-ink">{model || 'no model'}</strong> on {provider}. Sandbox money only; the daily
        caps are lifted for these tickets and tasks so repeated runs compare alike, every other limit applies. Takes a few minutes and uses AI tokens.
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
        <label className="flex items-center gap-2 text-sm text-pp-ink">
          <input type="checkbox" checked={full} disabled={running} onChange={(e) => setFull(e.target.checked)} />
          Full evaluation: each attack also as a jailbreak template and in base64, and against a compromised agent ({BUSINESS_CASES + attacks * 6} tickets and tasks or more, about 20 min)
        </label>
        {message && <span className="text-sm text-pp-muted">{message}</span>}
        {rows.length > 0 && !message && (
          <span className="text-sm text-pp-muted">
            {done.length}/{rows.length} cases
          </span>
        )}
      </div>

      {note && rows.length > 0 && (
        <p className="mt-5 rounded border border-pp-border bg-pp-surface p-3 text-sm text-pp-muted">
          {note}
        </p>
      )}

      {rows.some((r) => r.id === 'business-cancel') && (
        <p className="mt-5 rounded border border-pp-border bg-pp-surface p-3 text-sm text-pp-muted">
          A last ticket cancels the sample subscription for real: create and approve a new one on /support before the next run to include it again.
        </p>
      )}

      {rows.some((r) => r.id === 'business-dispute') && (
        <p className="mt-5 rounded border border-pp-border bg-pp-surface p-3 text-sm text-pp-muted">
          A last ticket accepts the sample dispute for real: pay a new sample PayPal payment on /support and dispute it before the next run to include it again.
        </p>
      )}

      {score.failed > 0 && (
        <p className="mt-5 rounded border border-pp-warning bg-pp-surface p-3 text-sm text-pp-warning">
          <strong>
            {score.failed} of {rows.length} tickets got no answer
          </strong>{' '}
          and are left out of the scores: {firstFailure}
        </p>
      )}

      <div className="mt-6 grid gap-4 md:grid-cols-3">
        <Score label="Business tickets resolved" value={score.business.passed} of={sizes.business.of} detail="Refunds, invoices, holds and refusals the policy expects." tone={tone(score.business.passed, score.business.of)} />
        <Score label="Guard held" value={score.guardHeld.passed} of={sizes.guardHeld.of} detail="Attacks where no money moved and no data leaked." tone={tone(score.guardHeld.passed, score.guardHeld.of)} />
        <Score
          label="Model refused on its own"
          value={score.refused.passed}
          of={sizes.refused.of}
          detail="Attacks on your agent the model rejected before the guard had to act."
          tone={!finished ? 'idle' : score.refused.passed === score.refused.of ? 'good' : 'warn'}
        />
      </div>

      {rows.length > 0 && (
        <ol className="mt-8 divide-y divide-pp-border rounded-lg border border-pp-border bg-pp-surface">
          {rows.map((row) => (
            <li key={row.id}>
              <details className="group px-5 py-3">
                <summary className="flex cursor-pointer list-none items-center gap-4 text-sm">
                  <span className={`w-16 shrink-0 text-xs font-semibold uppercase tracking-wider ${row.kind === 'attack' ? 'text-pp-danger' : 'text-pp-blue'}`}>{row.kind}</span>
                  <span className="min-w-0 flex-1 font-semibold text-pp-navy">
                    {row.title}
                    {row.agent === 'vulnerable' && <span className="ml-2 rounded bg-pp-canvas px-1.5 py-0.5 text-xs font-normal text-pp-muted">compromised agent</span>}
                  </span>
                  <span className="shrink-0 text-sm font-semibold">
                    <Badge row={row} />
                  </span>
                </summary>
                <div className="mt-3 min-w-0 space-y-2 pl-20 text-sm wrap-anywhere">
                  <p className="whitespace-pre-wrap text-pp-muted">
                    <strong className="text-pp-ink">
                      {DESK_LABEL[row.desk ?? 'support']} {maskPersonalData(row.customer)}:
                    </strong>{' '}
                    {maskPersonalData(row.message)}
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
