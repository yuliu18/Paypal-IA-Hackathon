import type { Metadata } from 'next';
import Link from 'next/link';
import { connection } from 'next/server';
import type { Money } from '@/lib/guard/domain/policy';
import { loadCatalog, withDefaultModels } from '@/lib/settings/catalog';
import { loadSettings } from '@/lib/settings/settings';

export const metadata: Metadata = { title: 'Overview' };

const format = (m: Money) => `${(m.minor / 100).toLocaleString('en-US', { minimumFractionDigits: 2 })} ${m.currency}`;

function Card({ title, href, action, children }: { title: string; href: string; action: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col rounded-lg border border-pp-border bg-pp-surface p-5">
      <h2 className="text-xs font-semibold uppercase tracking-wider text-pp-muted">{title}</h2>
      <div className="mt-2 flex-1 text-sm">{children}</div>
      <Link href={href} className="mt-4 text-sm font-semibold text-pp-blue hover:underline">
        {action} →
      </Link>
    </section>
  );
}

const STEPS = [
  { href: '/settings', title: 'Configure', detail: 'Your refund policy, money limits, AI provider and PayPal app.' },
  { href: '/evaluate', title: 'Evaluate the model', detail: 'Tickets your shop expects and nine attacks, scored in minutes.' },
  { href: '/support', title: 'Send a ticket', detail: 'The agent answers with PayPal tools; try a prompt injection too.' },
  { href: '/guard', title: 'Review the guard', detail: 'Every call allowed, held or blocked, in a tamper-evident log.' },
  { href: '/dashboard', title: 'Analyze', detail: 'Money protected and agent decisions in AG Studio reports.' },
];

// The control panel's home: what the agent runs on right now and the path through the demo.
// Shows no keys, only which provider and limits are in force.
export default async function Overview() {
  await connection();
  const [{ business, limits, ai: chosen, paypal }, catalog] = await Promise.all([loadSettings(), loadCatalog()]);
  const ai = await withDefaultModels(chosen, async () => catalog);
  const provider = catalog.providers.find((p) => p.id === ai.provider)?.label ?? 'Custom provider';

  return (
    <main className="mx-auto w-full max-w-5xl p-8 font-paypal text-pp-ink">
      <p className="text-sm font-semibold text-pp-blue">{business.name}</p>
      <h1 className="mt-1 text-[28px] font-semibold text-pp-navy">Payment Guard</h1>
      <p className="mt-2 max-w-2xl text-pp-muted">
        An AI support agent that refunds PayPal payments for your shop. Every call it makes passes through a guard that enforces your
        policy and limits, so a fooled or faulty model can&apos;t move money it shouldn&apos;t.
      </p>

      <div className="mt-8 grid gap-4 md:grid-cols-3">
        <Card title="AI" href="/settings" action="Change model">
          <p className="font-semibold text-pp-navy">{provider}</p>
          <p className="mt-1 text-pp-muted">
            Agent <code>{ai.agentModel || 'not set'}</code>
            {ai.defaulted && ' (provider default)'}
            <br />
            Judge <code>{ai.judgeModel || 'not set'}</code>
          </p>
          {!ai.apiKey && ai.baseUrl && <p className="mt-2 text-pp-warning">No API key yet.</p>}
        </Card>
        <Card title="Limits" href="/settings" action="Adjust limits">
          <ul className="space-y-1 text-pp-muted">
            <li>
              Automatic up to <strong className="text-pp-ink">{format(limits.approvalThreshold)}</strong>
            </li>
            <li>
              A person approves up to <strong className="text-pp-ink">{format(limits.perRefund)}</strong>
            </li>
            <li>
              At most <strong className="text-pp-ink">{format(limits.daily)}</strong> a day
            </li>
          </ul>
        </Card>
        <Card title="PayPal" href="/dashboard" action="See your PayPal data">
          <p className="font-semibold text-pp-navy">Sandbox</p>
          <p className="mt-1 text-pp-muted">{paypal.clientId && paypal.secret ? 'App credentials set. Money here is fictitious.' : 'No app credentials yet: add them in Settings.'}</p>
        </Card>
      </div>

      <h2 className="mt-10 text-xs font-semibold uppercase tracking-wider text-pp-muted">How it works</h2>
      <ol className="mt-3 grid gap-4 md:grid-cols-5">
        {STEPS.map((step, index) => (
          <li key={step.href}>
            <Link href={step.href} className="block h-full rounded-lg border border-pp-border bg-pp-surface p-4 hover:border-pp-blue">
              <span className="flex size-7 items-center justify-center rounded-full bg-pp-highlight text-sm font-semibold text-pp-blue">{index + 1}</span>
              <p className="mt-3 font-semibold text-pp-navy">{step.title}</p>
              <p className="mt-1 text-sm text-pp-muted">{step.detail}</p>
            </Link>
          </li>
        ))}
      </ol>
    </main>
  );
}
