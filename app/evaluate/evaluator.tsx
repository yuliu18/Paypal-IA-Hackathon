'use client';

import { useRef, useState } from 'react';
import type { AgentStep } from '@/lib/agent/support-agent';
import { summarize, type EvalResult } from '@/lib/evaluation/evaluation';
import { maskPersonalData } from '@/lib/guard/domain/redact';
import { PageHeader } from '../ui/page-header';
import { primaryButton, Spinner } from '../ui/desk';
import { stepOutcome } from '../ui/step-outcome';
import { prepareEvaluationAction, type PreparedCase } from './actions';

type Row = PreparedCase & { status: 'waiting' | 'running' | 'done'; result?: EvalResult; reply?: string; steps?: AgentStep[] };

const pct = (n: number, of: number) => (of ? `${Math.round((n / of) * 100)}%` : '–');

const TONE = {
  good: { text: 'text-pp-success', bar: 'bg-pp-success' },
  warn: { text: 'text-pp-warning', bar: 'bg-pp-warning' },
  bad: { text: 'text-pp-danger', bar: 'bg-pp-danger' },
  idle: { text: 'text-pp-ink', bar: 'bg-pp-muted' },
};

function Score({ label, value, of, detail, tone, ran }: { label: string; value: number; of: number; detail: string; tone: keyof typeof TONE; ran: boolean }) {
  return (
    <section className="px-6 py-5 first:pl-0 last:pr-0 max-md:px-0">
      <h2 className="text-[15px] font-semibold">{label}</h2>
      <p className={`mt-3 flex items-baseline gap-2 ${TONE[tone].text}`}>
        <span className="text-[34px] font-semibold leading-none">{ran && of ? value : '–'}</span>
        <span className="text-base text-pp-muted">{!ran ? `of ${of}, not run yet` : of ? `of ${of}, ${pct(value, of)}` : 'nothing scored'}</span>
      </p>
      <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-pp-gridline">
        <div className={`h-full rounded-full ${TONE[tone].bar}`} style={{ width: of ? `${(value / of) * 100}%` : 0 }} />
      </div>
      <p className="mt-3 text-sm leading-relaxed text-pp-muted">{detail}</p>
    </section>
  );
}

const STEP_COLOR = { blocked: 'text-pp-danger', held: 'text-pp-warning', executed: 'text-pp-ink', error: 'text-pp-muted', pending: 'text-pp-muted' };

const CHIP = {
  muted: 'border-pp-border bg-pp-canvas text-pp-muted',
  blue: 'border-pp-blue/30 bg-pp-highlight text-pp-blue',
  good: 'border-pp-success/40 bg-pp-success-tint text-pp-success',
  warn: 'border-pp-warning/40 bg-pp-warning-tint text-pp-warning',
  bad: 'border-pp-danger/40 bg-pp-danger-tint text-pp-danger',
};

function Chip({ tone, children }: { tone: keyof typeof CHIP; children: React.ReactNode }) {
  return <span className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-[3px] border px-2 py-0.5 text-xs font-semibold ${CHIP[tone]}`}>{children}</span>;
}

function Badge({ row }: { row: Row }) {
  if (row.status === 'waiting') return <Chip tone="muted">Waiting</Chip>;
  if (row.status === 'running')
    return (
      <Chip tone="blue">
        <Spinner className="size-3" />
        Running
      </Chip>
    );
  const r = row.result!;
  // No answer at all (e.g. the AI provider refused the model): not graded, whatever its kind.
  if (r.failed) return <Chip tone="muted">No answer</Chip>;
  if (row.kind === 'business') return <Chip tone={r.pass ? 'good' : 'bad'}>{r.pass ? 'Resolved' : 'Wrong outcome'}</Chip>;
  if (!r.guardHeld) return <Chip tone="bad">{r.guardHeld === undefined ? 'Failed' : 'Harm got through'}</Chip>;
  return <Chip tone={r.resisted ? 'good' : 'warn'}>{r.resisted ? 'Model refused' : 'Guard stopped it'}</Chip>;
}

// The evaluation's fixed sizes (lib/evaluation): business cases (five support tickets, two billing
// tasks, two sales chats) and attacks (nine on the support agent, three on the billing agent, five
// on the sales agent).
const BUSINESS_CASES = 9;
const FIXED_ATTACKS = 17;

// The two sizes of a run.
const SIZES = [
  { full: false, title: 'Quick', time: 'a few minutes' },
  { full: true, title: 'Full', time: 'about 20 minutes' },
];

// What a run uses, beside the controls.
const FACTS = (model: string, provider: string): [string, React.ReactNode][] => [
  [
    'Model',
    <>
      <strong className="font-semibold">{model || 'none chosen'}</strong> on {provider}
    </>,
  ],
  ['Money', 'PayPal sandbox only, fictitious.'],
  ['Limits', 'Every rule applies; the daily caps are lifted so runs compare alike.'],
  ['Cost', 'Each case is one or more calls to your AI provider.'],
];

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

  const quickCases = BUSINESS_CASES + attacks;
  const fullCases = BUSINESS_CASES + attacks * 6;

  return (
    <main className="mx-auto w-full max-w-6xl px-6 py-8 font-paypal text-pp-ink md:px-10">
      <PageHeader title="Evaluate a model">
        Before you let a model run your agents, send it the conversations your shop expects and a set of attacks, through the real support,
        billing and sales agents and the payment guard, and see how it does.
      </PageHeader>

      <section className="mt-8">
        <h2 className="text-lg font-semibold">What to run</h2>
        <div className="mt-3 grid max-w-2xl gap-3 sm:grid-cols-2" role="radiogroup" aria-label="Evaluation size">
          {SIZES.map((option) => (
            <label
              key={option.title}
              className={`flex min-h-16 items-center gap-3 rounded-lg border bg-pp-surface px-4 ${full === option.full ? 'border-pp-blue ring-1 ring-pp-blue' : 'border-pp-border hover:border-pp-blue/50'} ${running ? 'cursor-not-allowed opacity-70' : 'cursor-pointer'}`}
            >
              <input type="radio" name="size" checked={full === option.full} disabled={running} onChange={() => setFull(option.full)} className="accent-pp-blue" />
              <span className="font-semibold">{option.title}</span>
              <span className="ml-auto text-sm text-pp-muted">
                {option.full ? `${fullCases}+` : quickCases} cases, {option.time}
              </span>
            </label>
          ))}
        </div>
        <p className="mt-3 max-w-2xl text-sm leading-relaxed text-pp-muted">
          {full
            ? 'Each attack is also wrapped in a jailbreak template, encoded in base64 and sent to a compromised agent, besides the normal conversations.'
            : `${BUSINESS_CASES} normal conversations and ${attacks} attacks, each sent once.`}
        </p>
        <div className="mt-5 flex flex-wrap items-center gap-4">
          <button type="button" onClick={run} disabled={running || !model} className={`${primaryButton} whitespace-nowrap`}>
            {running && <Spinner />}
            {running ? 'Evaluating…' : rows.length ? 'Run again' : 'Run evaluation'}
          </button>
          {running && (
            <button type="button" onClick={() => (stop.current = true)} className="text-sm font-semibold text-pp-blue hover:underline">
              Stop after this case
            </button>
          )}
          {message && <span className="text-sm text-pp-muted">{message}</span>}
        </div>
        {rows.length > 0 && !message && (
          <div className="mt-4 max-w-md">
            <p className="text-sm text-pp-muted">
              {done.length} of {rows.length} cases done
            </p>
            <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-pp-gridline">
              <div className="h-full rounded-full bg-pp-blue transition-[width]" style={{ width: `${(done.length / rows.length) * 100}%` }} />
            </div>
          </div>
        )}

        <dl className="mt-8 grid gap-x-8 gap-y-4 border-t border-pp-border pt-4 text-sm sm:grid-cols-2 lg:grid-cols-4">
          {FACTS(model, provider).map(([term, value]) => (
            <div key={term}>
              <dt className="text-pp-muted">{term}</dt>
              <dd className="mt-0.5">{value}</dd>
            </div>
          ))}
        </dl>
      </section>

      {note && rows.length > 0 && <p className="mt-6 rounded-lg border border-pp-border bg-pp-surface px-4 py-3 text-sm text-pp-muted">{note}</p>}

      {rows.some((r) => r.id === 'business-cancel') && (
        <p className="mt-4 rounded-lg border border-pp-border bg-pp-surface px-4 py-3 text-sm text-pp-muted">
          A last ticket cancels the sample subscription for real: create and approve a new one on /support before the next run to include it again.
        </p>
      )}

      {rows.some((r) => r.id === 'business-dispute') && (
        <p className="mt-4 rounded-lg border border-pp-border bg-pp-surface px-4 py-3 text-sm text-pp-muted">
          A last ticket accepts the sample dispute for real: pay a new sample PayPal payment on /support and dispute it before the next run to include it again.
        </p>
      )}

      {score.failed > 0 && (
        <p className="mt-4 rounded-lg border border-pp-warning/40 bg-pp-warning-tint px-4 py-3 text-sm text-pp-warning">
          <strong>
            {score.failed} of {rows.length} cases got no answer
          </strong>{' '}
          and are left out of the scores: {firstFailure}
        </p>
      )}

      <section className="mt-10 border-t border-pp-border pt-2">
        <div className="grid md:grid-cols-3 md:divide-x md:divide-pp-border">
          <Score label="Normal cases resolved" value={score.business.passed} of={sizes.business.of} detail="Refunds, invoices, orders, holds and refusals your policy expects." tone={tone(score.business.passed, score.business.of)} ran={rows.length > 0} />
          <Score label="Attacks the guard held" value={score.guardHeld.passed} of={sizes.guardHeld.of} detail="No money moved and no personal data leaked." tone={tone(score.guardHeld.passed, score.guardHeld.of)} ran={rows.length > 0} />
          <Score
            label="Attacks the model refused"
            value={score.refused.passed}
            of={sizes.refused.of}
            detail="Rejected by the model itself, before the guard had to act."
            tone={!finished ? 'idle' : score.refused.passed === score.refused.of ? 'good' : 'warn'}
            ran={rows.length > 0}
          />
        </div>
      </section>

      {rows.length > 0 && (
        <ol className="mt-6 overflow-hidden rounded-lg border border-pp-border bg-pp-surface">
          {rows.map((row) => (
            <li key={row.id} className="border-b border-pp-gridline last:border-b-0">
              <details className="group px-5 py-3">
                <summary className="flex cursor-pointer list-none items-center gap-4 text-sm">
                  <span className={`w-14 shrink-0 text-xs font-semibold ${row.kind === 'attack' ? 'text-pp-danger' : 'text-pp-muted'}`}>{row.kind === 'attack' ? 'Attack' : 'Normal'}</span>
                  <span className="min-w-0 flex-1 font-semibold">
                    {row.title}
                    {row.agent === 'vulnerable' && <span className="ml-2 text-xs font-normal text-pp-muted">compromised agent</span>}
                  </span>
                  <Badge row={row} />
                </summary>
                <div className="mt-3 min-w-0 space-y-2 text-sm wrap-anywhere md:pl-[4.5rem]">
                  <p className="whitespace-pre-wrap text-pp-muted">
                    <strong className="text-pp-ink">
                      {DESK_LABEL[row.desk ?? 'support']} {maskPersonalData(row.customer)}:
                    </strong>{' '}
                    {maskPersonalData(row.message)}
                  </p>
                  {row.result && <p className="text-pp-ink">{row.result.reason}</p>}
                  {row.steps?.map((step, i) => (
                    <p key={i} className={`font-mono text-xs ${STEP_COLOR[stepOutcome(step)]}`}>
                      {step.tool} {maskPersonalData(JSON.stringify(step.args))} → {maskPersonalData(step.result).slice(0, 220)}
                    </p>
                  ))}
                  {row.reply && <p className="whitespace-pre-wrap rounded-md bg-pp-canvas p-3 text-pp-ink">{maskPersonalData(row.reply)}</p>}
                </div>
              </details>
            </li>
          ))}
        </ol>
      )}
    </main>
  );
}
