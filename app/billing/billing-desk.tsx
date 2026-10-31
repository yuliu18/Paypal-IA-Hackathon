'use client';

import Link from 'next/link';
import { useState } from 'react';
import type { AgentStep } from '@/lib/agent/support-agent';
import { SeedButton } from '../support/seed-button';
import { DeskLayout, fieldClass, labelClass, primaryButton, SamplePicker, SandboxData, sectionTitle, Spinner, ToolCalls, VulnerableToggle } from '../ui/desk';
import type { BillingScenario } from './scenarios';

type AgentMode = BillingScenario['agent'];

type Outcome = { reply: string; steps: AgentStep[]; redacted?: { ticket: number; reply: number } } | { error: string };

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

// Sends one billing task to the billing agent (app/api/billing/tasks) and shows each tool call it
// made through the payment guard, with what the guard did with each.
export function BillingDesk({ scenarios }: { scenarios: BillingScenario[] }) {
  const [customerEmail, setCustomerEmail] = useState(scenarios[0]?.customerEmail ?? '');
  const [message, setMessage] = useState(scenarios[0]?.message ?? '');
  const [agent, setAgent] = useState<AgentMode>(scenarios[0]?.agent ?? 'careful');
  const [running, setRunning] = useState(false);
  const [outcome, setOutcome] = useState<Outcome>();
  const [selected, setSelected] = useState(scenarios[0]?.label);

  function load(scenario: BillingScenario) {
    setSelected(scenario.label);
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
      const res = await fetch('/api/billing/tasks', {
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
    <DeskLayout
      title="Billing agent"
      intro="An AI billing agent bills the shop’s customers with PayPal invoices: it creates and sends them, and sends reminders."
      samples={
        scenarios.length > 0 ? (
          <SamplePicker title="Sample tasks" samples={scenarios} selected={selected} onSelect={load} />
        ) : (
          <>
            <p className="text-sm text-pp-warning">
              No sample tasks yet: the agent may only bill customers the shop knows, so create the sample payments first (also on the{' '}
              <Link href="/support" className="text-pp-blue hover:underline">
                support page
              </Link>
              ).
            </p>
            <SandboxData>
              <SeedButton label="Create sample payments" />
            </SandboxData>
          </>
        )
      }
    >
      <form onSubmit={submit} className="flex flex-col gap-4">
        <label className={labelClass}>
          Customer to bill, as the shop knows them
          <input value={customerEmail} onChange={(e) => setCustomerEmail(e.target.value)} className={fieldClass} />
        </label>
        <label className={labelClass}>
          Billing task, which can quote a customer’s notes
          <textarea value={message} onChange={(e) => setMessage(e.target.value)} rows={6} className={fieldClass} />
        </label>
        <VulnerableToggle checked={agent === 'vulnerable'} onChange={(on) => setAgent(on ? 'vulnerable' : 'careful')} where="task" />
        <button type="submit" disabled={running} className={primaryButton}>
          {running && <Spinner />}
          {running ? 'Agent working…' : 'Send task'}
        </button>
      </form>

      {outcome && 'error' in outcome && <p className="mt-6 text-sm text-pp-danger">{outcome.error}</p>}
      {outcome && 'reply' in outcome && (
        <div className="mt-8 flex flex-col gap-8">
          <ToolCalls steps={outcome.steps} />
          <section>
            <h2 className={sectionTitle}>Report to the shop</h2>
            <p className="mt-3 whitespace-pre-wrap rounded-lg border border-pp-border bg-pp-surface px-4 py-3 text-[15px] leading-relaxed">{outcome.reply}</p>
            {outcome.redacted && outcome.redacted.ticket + outcome.redacted.reply > 0 && (
              <p className="mt-2 text-xs font-semibold text-pp-blue">
                Privacy: {plural(outcome.redacted.ticket, 'card number')} masked in the task before the AI saw it,{' '}
                {plural(outcome.redacted.reply, 'item')} of personal data masked in the report.
              </p>
            )}
          </section>
        </div>
      )}
    </DeskLayout>
  );
}
