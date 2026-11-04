'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { Children, type ReactNode } from 'react';
import { maskPersonalData } from '@/lib/guard/domain/redact';
import { PageHeader } from './page-header';
import { stepOutcome } from './step-outcome';
import { VerdictStamp } from './verdict-stamp';

// The pieces the three agent desks (support, billing, sales) share: the page frame with the sample
// conversations at the left, the form's controls, and the tool calls the agent made.

export const fieldClass = 'rounded-md border border-pp-border bg-pp-surface px-3 py-2 text-[15px] font-normal text-pp-ink';
export const labelClass = 'flex flex-col gap-1.5 text-sm font-semibold';
export const primaryButton =
  'inline-flex items-center gap-2 self-start rounded-md bg-pp-blue px-4 py-2.5 text-sm font-semibold text-white hover:bg-pp-blue-dark disabled:cursor-wait disabled:opacity-80';
export const secondaryButton =
  'inline-flex shrink-0 items-center gap-2 rounded-md border border-pp-border bg-pp-surface px-3 py-1.5 text-sm font-semibold text-pp-ink hover:border-pp-blue disabled:cursor-wait disabled:text-pp-muted';
export const sectionTitle = 'text-base font-semibold';

// The usual turning ring of an app at work, while something runs at PayPal or the AI provider: a
// faint track with a quarter of it turning. The label beside it says what is happening.
export function Spinner({ className = '' }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={`size-4 shrink-0 animate-spin ${className}`} aria-hidden>
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity={0.25} strokeWidth={3} />
      <path d="M12 3a9 9 0 0 1 9 9" stroke="currentColor" strokeWidth={3} strokeLinecap="round" />
    </svg>
  );
}

// `setup`: what must exist before the samples work (support's PayPal test records), across the
// whole width above the two columns, so the columns stay about as tall as each other.
// `results`: what the agent did, across the whole width under both columns, so it never stretches
// one column alone.
export function DeskLayout({ title, intro, setup, samples, children, results }: { title: string; intro: ReactNode; setup?: ReactNode; samples: ReactNode; children: ReactNode; results?: ReactNode }) {
  const t = useTranslations('desks');
  return (
    <main className="mx-auto w-full max-w-6xl px-6 py-8 font-paypal text-pp-ink md:px-10">
      <PageHeader title={title}>
        {intro}{' '}
        {t.rich('layout.guardNote', {
          link: (chunks) => (
            <Link href="/guard" className="text-pp-blue hover:underline">
              {chunks}
            </Link>
          ),
        })}
      </PageHeader>
      {setup && <div className="mt-8">{setup}</div>}
      <div className="mt-8 grid items-start gap-10 lg:grid-cols-[19rem_minmax(0,1fr)]">
        <aside className="flex flex-col gap-8">{samples}</aside>
        <div className="min-w-0">{children}</div>
      </div>
      {results && <div className="mt-10 border-t border-pp-border pt-8">{results}</div>}
    </main>
  );
}

type Sample = { label: string; agent: 'careful' | 'vulnerable' };

// The sample conversations, one chosen at a time. An attack runs against the vulnerable agent, so
// its label drops the ", vulnerable agent" it carries and a tag says so instead.
// `labels`: each sample's label (as scenarios.ts names it) in the reader's language, without that suffix.
export function SamplePicker<T extends Sample>({
  samples,
  selected,
  onSelect,
  labels = {},
}: {
  samples: T[];
  selected?: string;
  onSelect: (sample: T) => void;
  labels?: Record<string, string>;
}) {
  const t = useTranslations('desks.samplePicker');
  return (
    <section>
      <h2 className={sectionTitle}>{t('heading')}</h2>
      <p className="mt-1 text-sm text-pp-muted">{t('hint')}</p>
      <ul className="mt-3 overflow-hidden rounded-lg border border-pp-border bg-pp-surface">
        {samples.map((sample) => {
          const active = sample.label === selected;
          const attack = sample.agent === 'vulnerable';
          return (
            <li key={sample.label} className="border-b border-pp-gridline last:border-b-0">
              <button
                type="button"
                onClick={() => onSelect(sample)}
                aria-pressed={active}
                className={`flex w-full items-start justify-between gap-3 border-l-[3px] px-4 py-3 text-left text-sm ${
                  active ? 'border-l-pp-blue bg-pp-highlight font-semibold' : 'border-l-transparent hover:bg-pp-canvas'
                }`}
              >
                <span>{labels[sample.label] ?? sample.label.replace(/, vulnerable agent$/, '')}</span>
                {attack && <span className="mt-px shrink-0 text-xs font-semibold text-pp-danger">{t('attack')}</span>}
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

// The PayPal test records the samples act on, apart from the conversation itself: a refund needs a
// payment to refund, a cancellation a subscription to cancel.
// One column per action: a single action (billing, in the narrow side column) keeps the full width.
const sandboxColumns = ['', '', 'md:grid-cols-2 md:divide-x', 'md:grid-cols-3 md:divide-x'];

export function SandboxData({ children }: { children: ReactNode }) {
  const t = useTranslations('desks.sandbox');
  const columns = sandboxColumns[Math.min(Children.toArray(children).length, 3)];
  return (
    <section>
      <h2 className={sectionTitle}>{t('heading')}</h2>
      <p className="mt-1 max-w-3xl text-sm text-pp-muted">{t('intro')}</p>
      <div className={`mt-3 grid rounded-lg border border-pp-border bg-pp-surface max-md:divide-y max-md:divide-pp-gridline md:divide-pp-gridline ${columns}`}>
        {children}
      </div>
    </section>
  );
}

export function VulnerableToggle({ checked, onChange, where }: { checked: boolean; onChange: (checked: boolean) => void; where: 'ticket' | 'task' | 'message' }) {
  const t = useTranslations('desks');
  return (
    <label className={`flex items-start gap-2.5 rounded-md border px-3 py-2.5 text-sm ${checked ? 'border-pp-danger/40 bg-pp-danger-tint' : 'border-pp-border bg-pp-surface'}`}>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="mt-0.5 accent-pp-danger" />
      <span>{t.rich('vulnerable', { where, strong: (chunks) => <span className="font-semibold">{chunks}</span> })}</span>
    </label>
  );
}

type Step = { tool: string; args: unknown; result: string; isError?: boolean };

// Each tool call with what the guard did with it. Masked like the guard log: a call can quote the
// customer's or someone else's email.
export function ToolCalls({ steps, note }: { steps: Step[]; note?: (step: Step) => ReactNode }) {
  const t = useTranslations('desks.toolCalls');
  return (
    <section>
      <h2 className={sectionTitle}>{t('heading')}</h2>
      <ol className="mt-3 flex flex-col gap-2">
        {steps.map((step, i) => (
          <li key={i} className="grid grid-cols-[5.5rem_minmax(0,1fr)] gap-x-3 rounded-lg border border-pp-border bg-pp-surface px-4 py-3 text-sm">
            <VerdictStamp outcome={stepOutcome(step)} className="h-fit justify-center" />
            <div className="min-w-0">
              <p className="break-all">
                <code className="font-mono font-semibold">{step.tool}</code>{' '}
                <code className="font-mono text-xs text-pp-muted">{maskPersonalData(JSON.stringify(step.args))}</code>
              </p>
              <p className="mt-1 line-clamp-3 text-pp-muted [overflow-wrap:anywhere]">{maskPersonalData(step.result)}</p>
              {note?.(step)}
            </div>
          </li>
        ))}
        {steps.length === 0 && <li className="text-sm text-pp-muted">{t('none')}</li>}
      </ol>
    </section>
  );
}
