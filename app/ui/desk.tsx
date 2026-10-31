'use client';

import Link from 'next/link';
import type { ReactNode } from 'react';
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

// A ring of dots turning while something runs at PayPal or the AI provider; still for people who
// asked their system for less motion, where the label beside it says what is happening.
export function Spinner({ className = '' }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={`size-4 shrink-0 motion-safe:animate-spin ${className}`} aria-hidden>
      {Array.from({ length: 8 }, (_, i) => {
        const angle = (i * Math.PI) / 4;
        return <circle key={i} cx={12 + 8 * Math.sin(angle)} cy={12 - 8 * Math.cos(angle)} r={2} fill="currentColor" opacity={0.25 + (i / 7) * 0.75} />;
      })}
    </svg>
  );
}

export function DeskLayout({ title, intro, samples, children }: { title: string; intro: ReactNode; samples: ReactNode; children: ReactNode }) {
  return (
    <main className="mx-auto w-full max-w-6xl px-6 py-8 font-paypal text-pp-ink md:px-10">
      <PageHeader title={title}>
        {intro} Every call goes through the payment guard; each decision is kept in the{' '}
        <Link href="/guard" className="text-pp-blue hover:underline">
          guard log
        </Link>
        .
      </PageHeader>
      <div className="mt-8 grid items-start gap-10 lg:grid-cols-[19rem_minmax(0,1fr)]">
        <aside className="flex flex-col gap-8">{samples}</aside>
        <div className="min-w-0">{children}</div>
      </div>
    </main>
  );
}

type Sample = { label: string; agent: 'careful' | 'vulnerable' };

// The sample conversations, one chosen at a time. An attack runs against the vulnerable agent, so
// its label drops the ", vulnerable agent" it carries and a tag says so instead.
export function SamplePicker<T extends Sample>({ title, samples, selected, onSelect }: { title: string; samples: T[]; selected?: string; onSelect: (sample: T) => void }) {
  return (
    <section>
      <h2 className={sectionTitle}>{title}</h2>
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
                <span>{sample.label.replace(/, vulnerable agent$/, '')}</span>
                {attack && <span className="mt-px shrink-0 text-xs font-semibold text-pp-danger">Attack</span>}
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

// The sandbox data the samples refer to, apart from the conversation itself.
export function SandboxData({ children }: { children: ReactNode }) {
  return (
    <section>
      <h2 className={sectionTitle}>Sandbox data</h2>
      <p className="mt-1 text-sm text-pp-muted">The samples refer to these PayPal sandbox records. Money here is fictitious.</p>
      <div className="mt-3 flex flex-col divide-y divide-pp-gridline rounded-lg border border-pp-border bg-pp-surface">{children}</div>
    </section>
  );
}

export function VulnerableToggle({ checked, onChange, where }: { checked: boolean; onChange: (checked: boolean) => void; where: string }) {
  return (
    <label className={`flex items-start gap-2.5 rounded-md border px-3 py-2.5 text-sm ${checked ? 'border-pp-danger/40 bg-pp-danger-tint' : 'border-pp-border bg-pp-surface'}`}>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="mt-0.5 accent-pp-danger" />
      <span>
        <span className="font-semibold">Vulnerable agent.</span> It obeys any instruction in the {where}, like a misconfigured or compromised
        agent. Only the guard stands between it and PayPal.
      </span>
    </label>
  );
}

type Step = { tool: string; args: unknown; result: string; isError?: boolean };

// Each tool call with what the guard did with it. Masked like the guard log: a call can quote the
// customer's or someone else's email.
export function ToolCalls({ steps, note }: { steps: Step[]; note?: (step: Step) => ReactNode }) {
  return (
    <section>
      <h2 className={sectionTitle}>What the agent did</h2>
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
        {steps.length === 0 && <li className="text-sm text-pp-muted">The agent called no tool.</li>}
      </ol>
    </section>
  );
}
