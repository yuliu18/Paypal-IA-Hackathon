'use client';

import Link from 'next/link';
import { useState } from 'react';
import type { AgentStep } from '@/lib/agent/support-agent';
import { SeedButton } from './seed-button';

type AgentMode = 'careful' | 'vulnerable';
export type Scenario = { label: string; agent: AgentMode; customerEmail: string; message: string };

type Outcome = { reply: string; steps: AgentStep[] } | { error: string };

// Held refunds (lib/guard/guard.ts heldResult) wait for a person on /guard: amber, not red.
const stepStyle = (step: AgentStep) =>
  step.isError ? 'border-pp-danger text-pp-danger' : step.result.startsWith('Refund held for human approval') ? 'border-pp-warning text-pp-warning' : 'border-pp-border';

// Sends one ticket to the support agent (app/api/support/tickets) and shows each tool call it
// made through the payment guard, blocked ones in red and held ones in amber.
export function SupportDesk({ scenarios }: { scenarios: Scenario[] }) {
  const [customerEmail, setCustomerEmail] = useState(scenarios[0]?.customerEmail ?? '');
  const [message, setMessage] = useState(scenarios[0]?.message ?? '');
  const [agent, setAgent] = useState<AgentMode>(scenarios[0]?.agent ?? 'careful');
  const [running, setRunning] = useState(false);
  const [outcome, setOutcome] = useState<Outcome>();

  function load(scenario: Scenario) {
    setCustomerEmail(scenario.customerEmail);
    setMessage(scenario.message);
    setAgent(scenario.agent);
    setOutcome(undefined);
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setRunning(true);
    setOutcome(undefined);
    try {
      const res = await fetch('/api/support/tickets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ customerEmail, message, agent }),
      });
      const body = await res.json();
      setOutcome(res.ok ? body : { error: body.error?.message ?? `Request failed (${res.status})` });
    } catch (error) {
      setOutcome({ error: error instanceof Error ? error.message : String(error) });
    } finally {
      setRunning(false);
    }
  }

  return (
    <main className="mx-auto w-full max-w-4xl px-8 py-6 font-paypal text-pp-ink">
      <Link href="/" className="text-sm font-semibold text-pp-blue hover:underline">
        ← All pages
      </Link>
      <h1 className="mt-3 text-[28px] font-semibold text-pp-navy">Support agent demo</h1>
      <p className="mt-2 text-sm text-pp-muted">
        An AI support agent answers the ticket with PayPal tools. Every call goes through the payment guard; decisions are
        listed in the{' '}
        <Link href="/guard" className="text-pp-blue hover:underline">
          guard log
        </Link>
        .
      </p>

      {scenarios.length > 0 ? (
        <div className="mt-4 flex flex-wrap items-center gap-2">
          {scenarios.map((scenario) => (
            <button
              key={scenario.label}
              type="button"
              onClick={() => load(scenario)}
              className="rounded border border-pp-border bg-pp-surface px-3 py-1.5 text-sm font-semibold text-pp-navy hover:bg-pp-highlight"
            >
              {scenario.label}
            </button>
          ))}
          <SeedButton label="New sample payments" />
        </div>
      ) : (
        <div className="mt-4 flex flex-col gap-2">
          <p className="text-sm text-pp-warning">No sample tickets yet: create the sandbox payments they refer to.</p>
          <SeedButton label="Create sample payments" />
        </div>
      )}

      <form onSubmit={submit} className="mt-4 flex flex-col gap-3">
        <label className="flex flex-col gap-1 text-sm font-semibold">
          Ticket customer (as the shop knows them)
          <input
            value={customerEmail}
            onChange={(e) => setCustomerEmail(e.target.value)}
            className="rounded border border-pp-border bg-pp-surface px-3 py-2 font-normal"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm font-semibold">
          Ticket message (untrusted)
          <textarea
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            rows={6}
            className="rounded border border-pp-border bg-pp-surface px-3 py-2 font-normal"
          />
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={agent === 'vulnerable'} onChange={(e) => setAgent(e.target.checked ? 'vulnerable' : 'careful')} />
          Vulnerable agent: obeys any instruction in the ticket, like a misconfigured or compromised one
        </label>
        <button
          type="submit"
          disabled={running}
          className="self-start rounded bg-pp-blue px-4 py-2 text-sm font-semibold text-white hover:bg-pp-blue-dark disabled:opacity-60"
        >
          {running ? 'Agent working…' : 'Send ticket'}
        </button>
      </form>

      {outcome && 'error' in outcome && <p className="mt-6 text-sm text-pp-danger">{outcome.error}</p>}
      {outcome && 'reply' in outcome && (
        <section className="mt-6">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-pp-muted">Tool calls</h2>
          <ol className="mt-2 flex flex-col gap-2">
            {outcome.steps.map((step, i) => (
              <li
                key={i}
                className={`rounded border px-3 py-2 text-sm ${stepStyle(step)}`}
              >
                <code className="font-semibold">{step.tool}</code> <code className="text-pp-muted">{JSON.stringify(step.args)}</code>
                <p className="mt-1 line-clamp-3 break-all">{step.result}</p>
              </li>
            ))}
            {outcome.steps.length === 0 && <li className="text-sm text-pp-muted">No tool calls.</li>}
          </ol>
          <h2 className="mt-6 text-sm font-semibold uppercase tracking-wider text-pp-muted">Reply to the customer</h2>
          <p className="mt-2 whitespace-pre-wrap rounded border border-pp-border bg-pp-surface px-3 py-2 text-sm">{outcome.reply}</p>
        </section>
      )}
    </main>
  );
}
