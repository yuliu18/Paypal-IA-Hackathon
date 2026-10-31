'use client';

import { useState } from 'react';
import type { AgentStep } from '@/lib/agent/support-agent';
import { DeskLayout, fieldClass, labelClass, primaryButton, SamplePicker, SandboxData, sectionTitle, Spinner, ToolCalls, VulnerableToggle } from '../ui/desk';
import type { Scenario } from './scenarios';
import { SeedButton } from './seed-button';
import { DisputePaymentButton, type DisputePaymentStep } from './dispute-payment-button';
import { SubscriptionButton } from './subscription-button';

type AgentMode = Scenario['agent'];

type Outcome = { reply: string; steps: AgentStep[]; redacted?: { ticket: number; reply: number } } | { error: string };

// The fields the guard kept from the agent in a get_order answer (lib/guard/domain/privacy.ts).
function withheldFields(step: AgentStep): number {
  try {
    const withheld = (JSON.parse(step.result) as { withheld_by_guard?: unknown }).withheld_by_guard;
    return Array.isArray(withheld) ? withheld.length : 0;
  } catch {
    return 0;
  }
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

// Sends one ticket to the support agent (app/api/support/tickets) and shows each tool call it
// made through the payment guard, with what the guard did with each.
// `pendingApproveUrl`: the sample subscription's approval link while no buyer has approved it yet.
// `disputePayment`: where the sample PayPal payment for the dispute tickets stands.
export function SupportDesk({
  scenarios,
  pendingApproveUrl,
  disputePayment,
}: {
  scenarios: Scenario[];
  pendingApproveUrl?: string;
  disputePayment: DisputePaymentStep;
}) {
  const [customerEmail, setCustomerEmail] = useState(scenarios[0]?.customerEmail ?? '');
  const [message, setMessage] = useState(scenarios[0]?.message ?? '');
  const [agent, setAgent] = useState<AgentMode>(scenarios[0]?.agent ?? 'careful');
  const [running, setRunning] = useState(false);
  const [outcome, setOutcome] = useState<Outcome>();
  const [selected, setSelected] = useState(scenarios[0]?.label);

  function load(scenario: Scenario) {
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
    <DeskLayout
      title="Support agent"
      intro="An AI support agent answers a customer’s ticket with PayPal tools: it can refund an order, accept a dispute or cancel a subscription."
      samples={
        <>
          {scenarios.length > 0 ? (
            <SamplePicker samples={scenarios} selected={selected} onSelect={load} />
          ) : (
            <p className="text-sm text-pp-warning">No sample tickets yet: create the sandbox payments they refer to.</p>
          )}
          <SandboxData>
            <SeedButton label={scenarios.length > 0 ? 'New sample payments' : 'Create sample payments'} />
            <SubscriptionButton pendingApproveUrl={pendingApproveUrl} />
            <DisputePaymentButton payment={disputePayment} />
          </SandboxData>
        </>
      }
    >
      <form onSubmit={submit} className="flex flex-col gap-4">
        <label className={labelClass}>
          Ticket customer, as the shop knows them
          <input value={customerEmail} onChange={(e) => setCustomerEmail(e.target.value)} className={fieldClass} />
        </label>
        <label className={labelClass}>
          Ticket message, written by whoever sent it
          <textarea value={message} onChange={(e) => setMessage(e.target.value)} rows={6} className={fieldClass} />
        </label>
        <VulnerableToggle checked={agent === 'vulnerable'} onChange={(on) => setAgent(on ? 'vulnerable' : 'careful')} where="ticket" />
        <button type="submit" disabled={running} className={primaryButton}>
          {running && <Spinner />}
          {running ? 'Agent working…' : 'Send ticket'}
        </button>
      </form>

      {outcome && 'error' in outcome && <p className="mt-6 text-sm text-pp-danger">{outcome.error}</p>}
      {outcome && 'reply' in outcome && (
        <div className="mt-8 flex flex-col gap-8">
          <ToolCalls
            steps={outcome.steps}
            note={(step) =>
              withheldFields(step as AgentStep) > 0 && (
                <p className="mt-1 text-xs font-semibold text-pp-blue">
                  Privacy: {plural(withheldFields(step as AgentStep), 'personal data field')} hidden from the agent (card, names, emails, addresses)
                </p>
              )
            }
          />
          <section>
            <h2 className={sectionTitle}>Reply to the customer</h2>
            <p className="mt-3 whitespace-pre-wrap rounded-lg border border-pp-border bg-pp-surface px-4 py-3 text-[15px] leading-relaxed">{outcome.reply}</p>
            {outcome.redacted && outcome.redacted.ticket + outcome.redacted.reply > 0 && (
              <p className="mt-2 text-xs font-semibold text-pp-blue">
                Privacy: {plural(outcome.redacted.ticket, 'card number')} masked in the ticket before the AI saw it,{' '}
                {plural(outcome.redacted.reply, 'item')} of personal data masked in the reply.
              </p>
            )}
          </section>
        </div>
      )}
    </DeskLayout>
  );
}
