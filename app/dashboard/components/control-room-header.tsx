import Link from 'next/link';
import { AGENTS, type ControlRoomCounters } from '../control-room/counters';
import styles from '../control-room/control-room.module.css';

// The control room's own header above the AG Studio canvas: the payment guard is active, which AI
// agents it watches, and the money it has seen, computed from the rows the report reads
// (../control-room/counters.ts). These are totals for the whole log: the agent switch on the canvas
// filters the widgets below, not this header.

const usd = (amount: number) =>
  amount.toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
    // Whole dollars once the figure is large; cents would only add noise.
    maximumFractionDigits: Math.abs(amount) >= 10_000 ? 0 : 2,
    minimumFractionDigits: Math.abs(amount) >= 10_000 ? 0 : 2,
  });

const when = (iso: string) =>
  `${new Date(iso).toLocaleString('en-GB', { timeZone: 'UTC', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })} UTC`;

export function ControlRoomHeader({ counters }: { counters: ControlRoomCounters }) {
  const blockRate = counters.decisions ? Math.round((counters.blocked / counters.decisions) * 100) : 0;
  return (
    <section aria-label="Payment guard status" className={`${styles.band} mx-4 mb-2 px-5 py-5 sm:mx-8 sm:px-7`}>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs font-semibold uppercase tracking-[0.18em]">
        <span className="text-pp-navy">Payment guard</span>
        <span className="text-pp-border" aria-hidden>
          ·
        </span>
        <span className={`${styles.status} inline-flex items-center gap-2`}>
          <span className={styles.dot} aria-hidden />
          Active
        </span>
        <span className="text-pp-border" aria-hidden>
          ·
        </span>
        <span className="text-pp-ink">{AGENTS.length} agents online</span>
        <span className="flex flex-wrap gap-2 normal-case tracking-normal">
          {AGENTS.map((agent) => (
            <span
              key={agent.id}
              title={agent.does}
              className="inline-flex items-center gap-1.5 rounded-full border border-pp-border px-2.5 py-0.5 text-xs font-medium text-pp-ink"
            >
              <span className="size-1.5 rounded-full bg-pp-success" aria-hidden />
              {agent.name}
            </span>
          ))}
        </span>
        <span className="ml-auto text-[11px] font-medium normal-case tracking-normal text-pp-muted">
          {counters.decisions.toLocaleString('en-US')} calls checked · {blockRate}% blocked
          {counters.lastDecisionAt && <> · last {when(counters.lastDecisionAt)}</>}
        </span>
      </div>

      <dl className="mt-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Counter label="Money protected" hint="Refunds and dispute payouts the guard blocked" value={usd(counters.protected)} tone={styles.protected} />
        <Counter label="Money moved" hint="Refunds and dispute payouts the guard allowed" value={usd(counters.moved)} tone={styles.moved} />
        <Counter label="Money billed" hint="Invoices the billing agent created (not yet paid)" value={usd(counters.billed)} tone={styles.billed} />
        <div className={`${styles.counter} ${styles.awaitingCard} relative px-4 py-3 transition-colors`}>
          <dt className="text-xs font-semibold uppercase tracking-wider text-pp-muted">Awaiting approval</dt>
          <dd className={`${styles.figure} ${counters.awaiting ? styles.awaiting : styles.calm} mt-1 text-2xl font-bold sm:text-4xl`}>
            {counters.awaiting}
          </dd>
          <dd className="mt-1 text-xs">
            {/* The link covers the whole card, so the card is the click target. */}
            <Link href="/guard" className="text-pp-sky after:absolute after:inset-0 after:rounded-xl hover:underline">
              {counters.awaiting ? 'Decide them on /guard →' : 'Open the guard →'}
            </Link>
          </dd>
        </div>
      </dl>
    </section>
  );
}

function Counter({ label, hint, value, tone }: { label: string; hint: string; value: string; tone: string }) {
  return (
    <div className={`${styles.counter} px-4 py-3`}>
      <dt className="text-xs font-semibold uppercase tracking-wider text-pp-muted">{label}</dt>
      <dd className={`${styles.figure} ${tone} mt-1 truncate text-2xl font-bold sm:text-4xl`} title={value}>
        {value}
      </dd>
      <dd className="mt-1 text-xs text-pp-muted">{hint}</dd>
    </div>
  );
}
