'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import type { AgentStep } from '@/lib/agent/support-agent';
import { SeedButton } from '../support/seed-button';
import { DeskLayout, fieldClass, labelClass, primaryButton, SamplePicker, SandboxData, sectionTitle, Spinner, ToolCalls, VulnerableToggle } from '../ui/desk';
import type { BillingScenario } from './scenarios';

type AgentMode = BillingScenario['agent'];

type Outcome = { reply: string; steps: AgentStep[]; redacted?: { ticket: number; reply: number } } | { error: string };

// The sample tasks' labels (scenarios.ts) to their messages under desks.billing.samples.
const SAMPLE_KEYS: Record<string, string> = {
  'Invoice extra items': 'invoiceExtra',
  'Invoice over the approval limit': 'invoiceOverLimit',
  'Injected invoice, vulnerable agent': 'injectedInvoice',
};

// Sends one billing task to the billing agent (app/api/billing/tasks) and shows each tool call it
// made through the payment guard, with what the guard did with each.
export function BillingDesk({ scenarios }: { scenarios: BillingScenario[] }) {
  const t = useTranslations('desks');
  const labels = Object.fromEntries(Object.entries(SAMPLE_KEYS).map(([label, key]) => [label, t(`billing.samples.${key}`)]));
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
      setOutcome(res.ok ? body : { error: body.error?.message ?? t('form.requestFailed', { status: res.status }) });
    } catch (error) {
      setOutcome({ error: error instanceof Error ? error.message : String(error) });
    } finally {
      setRunning(false);
    }
  }

  return (
    <DeskLayout
      title={t('billing.title')}
      intro={t('billing.intro')}
      samples={
        scenarios.length > 0 ? (
          <SamplePicker samples={scenarios} selected={selected} onSelect={load} labels={labels} />
        ) : (
          <>
            <p className="text-sm text-pp-warning">
              {t.rich('billing.noSamples', {
                link: (chunks) => (
                  <Link href="/support" className="text-pp-blue hover:underline">
                    {chunks}
                  </Link>
                ),
              })}
            </p>
            <SandboxData>
              <SeedButton label={t('billing.createPayments')} />
            </SandboxData>
          </>
        )
      }
      results={
        outcome && (
          <>
          {'error' in outcome && <p className="text-sm text-pp-danger">{outcome.error}</p>}
          {'reply' in outcome && (
            <div className="grid gap-8 lg:grid-cols-2">
              <ToolCalls steps={outcome.steps} />
              <section>
                <h2 className={sectionTitle}>{t('billing.replyHeading')}</h2>
                <p className="mt-3 whitespace-pre-wrap rounded-lg border border-pp-border bg-pp-surface px-4 py-3 text-[15px] leading-relaxed">{outcome.reply}</p>
                {outcome.redacted && outcome.redacted.ticket + outcome.redacted.reply > 0 && (
                  <p className="mt-2 text-xs font-semibold text-pp-blue">
                    {t('billing.redacted', { cards: outcome.redacted.ticket, items: outcome.redacted.reply })}
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
          {t('billing.customerLabel')}
          <input value={customerEmail} onChange={(e) => setCustomerEmail(e.target.value)} className={fieldClass} />
        </label>
        <label className={labelClass}>
          {t('billing.messageLabel')}
          <textarea value={message} onChange={(e) => setMessage(e.target.value)} rows={6} className={fieldClass} />
        </label>
        <VulnerableToggle checked={agent === 'vulnerable'} onChange={(on) => setAgent(on ? 'vulnerable' : 'careful')} where="task" />
        <button type="submit" disabled={running} className={primaryButton}>
          {running && <Spinner />}
          {running ? t('form.working') : t('billing.send')}
        </button>
      </form>

    </DeskLayout>
  );
}
