'use client';

import { useTranslations } from 'next-intl';
import { useState } from 'react';
import type { AgentStep } from '@/lib/agent/support-agent';
import { DeskLayout, fieldClass, labelClass, primaryButton, SamplePicker, sectionTitle, Spinner, ToolCalls, VulnerableToggle } from '../ui/desk';
import type { SalesScenario } from './scenarios';

type AgentMode = SalesScenario['agent'];

export type CheckoutNotice = { tone: 'ok' | 'error' | 'muted'; text: string };
const NOTICE_STYLE = {
  ok: 'border-pp-success/40 bg-pp-success-tint text-pp-success',
  error: 'border-pp-danger/40 bg-pp-danger-tint text-pp-danger',
  muted: 'border-pp-border bg-pp-surface text-pp-muted',
};

type Outcome = { reply: string; steps: AgentStep[]; redacted?: { ticket: number; reply: number } } | { error: string };

// The sample chats' labels (scenarios.ts) to their messages under desks.sales.samples.
const SAMPLE_KEYS: Record<string, string> = {
  'Buy two mug sets': 'buyMugs',
  'Order over the approval limit': 'overLimit',
  'Injected 90% discount': 'injectedDiscount',
  'Injected price override': 'injectedPrice',
  'Order for another customer': 'otherCustomer',
  'Huge quantity': 'hugeQuantity',
  'Return link elsewhere': 'returnLink',
};

// The reply with its links clickable, so the customer can open PayPal's approval page.
// A sentence's closing punctuation isn't part of the link.
const URL_PART = /(https:\/\/[^\s)"'<>]*[^\s)"'<>.,;:!?])/;
const withLinks = (text: string) =>
  text.split(URL_PART).map((part, i) =>
    i % 2 === 1 ? (
      <a key={i} href={part} target="_blank" rel="noreferrer" className="break-all text-pp-blue hover:underline">
        {part}
      </a>
    ) : (
      part
    ),
  );

// Sends one customer message to the sales agent (app/api/sales/chats) and shows each tool call it
// made through the payment guard, with what the guard did with each.
export function SalesDesk({ scenarios, notice }: { scenarios: SalesScenario[]; notice?: CheckoutNotice }) {
  const t = useTranslations('desks');
  const labels = Object.fromEntries(Object.entries(SAMPLE_KEYS).map(([label, key]) => [label, t(`sales.samples.${key}`)]));
  const [customerEmail, setCustomerEmail] = useState(scenarios[0]?.customerEmail ?? '');
  const [message, setMessage] = useState(scenarios[0]?.message ?? '');
  const [agent, setAgent] = useState<AgentMode>(scenarios[0]?.agent ?? 'careful');
  const [running, setRunning] = useState(false);
  const [outcome, setOutcome] = useState<Outcome>();
  const [selected, setSelected] = useState(scenarios[0]?.label);

  function load(scenario: SalesScenario) {
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
      const res = await fetch('/api/sales/chats', {
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
      title={t('sales.title')}
      intro={t('sales.intro')}
      samples={<SamplePicker samples={scenarios} selected={selected} onSelect={load} labels={labels} />}
      results={
        outcome && (
          <>
          {'error' in outcome && <p className="text-sm text-pp-danger">{outcome.error}</p>}
          {'reply' in outcome && (
            <div className="grid gap-8 lg:grid-cols-2">
              <ToolCalls steps={outcome.steps} />
              <section>
                <h2 className={sectionTitle}>{t('sales.replyHeading')}</h2>
                <p className="mt-3 whitespace-pre-wrap rounded-lg border border-pp-border bg-pp-surface px-4 py-3 text-[15px] leading-relaxed">{withLinks(outcome.reply)}</p>
                {outcome.redacted && outcome.redacted.ticket + outcome.redacted.reply > 0 && (
                  <p className="mt-2 text-xs font-semibold text-pp-blue">
                    {t('sales.redacted', { cards: outcome.redacted.ticket, items: outcome.redacted.reply })}
                  </p>
                )}
              </section>
            </div>
          )}
          </>
        )
      }
    >
      {notice && <p className={`mb-6 rounded-lg border px-4 py-3 text-sm font-semibold ${NOTICE_STYLE[notice.tone]}`}>{notice.text}</p>}
      <form onSubmit={submit} className="flex flex-col gap-4">
        <label className={labelClass}>
          {t('sales.customerLabel')}
          <input value={customerEmail} onChange={(e) => setCustomerEmail(e.target.value)} className={fieldClass} />
        </label>
        <label className={labelClass}>
          {t('sales.messageLabel')}
          <textarea value={message} onChange={(e) => setMessage(e.target.value)} rows={6} className={fieldClass} />
        </label>
        <VulnerableToggle checked={agent === 'vulnerable'} onChange={(on) => setAgent(on ? 'vulnerable' : 'careful')} where="message" />
        <button type="submit" disabled={running} className={primaryButton}>
          {running && <Spinner />}
          {running ? t('form.working') : t('sales.send')}
        </button>
      </form>

    </DeskLayout>
  );
}
