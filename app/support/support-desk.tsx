'use client';

import { useTranslations } from 'next-intl';
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

// The sample tickets' labels (scenarios.ts) to their messages under desks.support.samples.
const SAMPLE_KEYS: Record<string, string> = {
  'Legitimate ticket': 'legitimate',
  'Prompt injection, vulnerable agent': 'promptInjection',
  'Cancel subscription': 'cancelSubscription',
  "Cancel someone else's subscription, vulnerable agent": 'cancelOthersSubscription',
  'Settle my dispute': 'settleDispute',
  "Settle someone else's dispute, vulnerable agent": 'settleOthersDispute',
};

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
  const t = useTranslations('desks');
  const labels = Object.fromEntries(Object.entries(SAMPLE_KEYS).map(([label, key]) => [label, t(`support.samples.${key}`)]));
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
      setOutcome(res.ok ? body : { error: body.error?.message ?? t('form.requestFailed', { status: res.status }) });
    } catch (error) {
      setOutcome({ error: error instanceof Error ? error.message : String(error) });
    } finally {
      setRunning(false);
    }
  }

  return (
    <DeskLayout
      title={t('support.title')}
      intro={t('support.intro')}
      setup={
        <SandboxData>
          <SeedButton label={scenarios.length > 0 ? t('support.newPayments') : t('support.createPayments')} />
          <SubscriptionButton pendingApproveUrl={pendingApproveUrl} />
          <DisputePaymentButton payment={disputePayment} />
        </SandboxData>
      }
      samples={
        scenarios.length > 0 ? (
          <SamplePicker samples={scenarios} selected={selected} onSelect={load} labels={labels} />
        ) : (
          <p className="text-sm text-pp-warning">{t('support.noSamples')}</p>
        )
      }
      results={
        outcome && (
          <>
          {'error' in outcome && <p className="text-sm text-pp-danger">{outcome.error}</p>}
          {'reply' in outcome && (
            <div className="grid gap-8 lg:grid-cols-2">
              <ToolCalls
                steps={outcome.steps}
                note={(step) =>
                  withheldFields(step as AgentStep) > 0 && (
                    <p className="mt-1 text-xs font-semibold text-pp-blue">
                      {t('support.withheld', { count: withheldFields(step as AgentStep) })}
                    </p>
                  )
                }
              />
              <section>
                <h2 className={sectionTitle}>{t('support.replyHeading')}</h2>
                <p className="mt-3 whitespace-pre-wrap rounded-lg border border-pp-border bg-pp-surface px-4 py-3 text-[15px] leading-relaxed">{outcome.reply}</p>
                {outcome.redacted && outcome.redacted.ticket + outcome.redacted.reply > 0 && (
                  <p className="mt-2 text-xs font-semibold text-pp-blue">
                    {t('support.redacted', { cards: outcome.redacted.ticket, items: outcome.redacted.reply })}
                  </p>
                )}
              </section>
            </div>
          )}
          </>
        )
      }
    >
      <form onSubmit={submit} className="flex flex-col gap-4">
        <label className={labelClass}>
          {t('support.customerLabel')}
          <input value={customerEmail} onChange={(e) => setCustomerEmail(e.target.value)} className={fieldClass} />
        </label>
        <label className={labelClass}>
          {t('support.messageLabel')}
          <textarea value={message} onChange={(e) => setMessage(e.target.value)} rows={6} className={fieldClass} />
        </label>
        <VulnerableToggle checked={agent === 'vulnerable'} onChange={(on) => setAgent(on ? 'vulnerable' : 'careful')} where="ticket" />
        <button type="submit" disabled={running} className={primaryButton}>
          {running && <Spinner />}
          {running ? t('form.working') : t('support.send')}
        </button>
      </form>

    </DeskLayout>
  );
}
