import type { CSSProperties } from 'react';
import Link from 'next/link';
import type { ControlRoomCounters } from '../control-room/counters';
import { heroSentence, verdictShares, type VerdictTally } from '../control-room/hero';
import styles from '../control-room/control-room.module.css';

// The opening of the dashboard, above the AG Studio canvas: one sentence saying what the shop's AI
// agents did with its PayPal account, a strip splitting their calls into what went through, what
// waits for the owner and what the guard stopped, and a line of money. Everything comes from the
// rows the report reads (../control-room/counters.ts and hero.ts) and covers the whole log: the
// agent switch on the canvas filters the widgets below, not this.

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

const SEGMENTS = [
  { key: 'allowed', label: 'went through', tone: styles.allowed },
  { key: 'held', label: 'held for you', tone: styles.held },
  { key: 'blocked', label: 'stopped', tone: styles.blocked },
] as const;

export function ControlRoomHeader({ counters, calls }: { counters: ControlRoomCounters; calls: VerdictTally }) {
  const shares = verdictShares(calls);
  const shown = SEGMENTS.filter((s) => calls[s.key] > 0);
  return (
    // On a phone the guard's status moves under the money, so the sentence opens the page.
    <section
      aria-label="What your agents did"
      className={`${styles.hero} mx-4 mb-4 flex flex-col pt-2 pb-8 sm:mx-8 lg:grid lg:grid-cols-[1fr_auto] lg:gap-x-10`}
    >
      <p className={`${styles.sentence} lg:col-start-1 lg:row-start-1`}>{heroSentence(calls)}</p>
      <div className="order-last mt-6 text-sm text-pp-muted lg:order-none lg:col-start-2 lg:row-start-1 lg:mt-0 lg:pt-2 lg:text-right">
        <p className="inline-flex items-center gap-2 font-medium text-pp-ink">
          <span className={styles.statusDot} aria-hidden />
          Guard on
        </p>
        <p className="mt-0.5">Watching the support and billing agents</p>
        {counters.lastDecisionAt && <p className="mt-0.5">Last call {when(counters.lastDecisionAt)}</p>}
      </div>

      {calls.calls === 0 ? (
        <p className="mt-4 max-w-[60ch] text-base text-pp-muted lg:col-span-2">
          Send a ticket from the{' '}
          <Link href="/support" className={styles.link}>
            support desk
          </Link>{' '}
          or a task from the{' '}
          <Link href="/billing" className={styles.link}>
            billing desk
          </Link>
          , and every PayPal call the agents make shows up here.
        </p>
      ) : (
        <figure className="mt-7 lg:col-span-2">
          <div className={styles.strip} role="img" aria-label={shown.map((s) => `${shares[s.key]}% ${s.label}`).join(', ')}>
            {shown.map((s) => (
              <span key={s.key} className={`${styles.segment} ${s.tone}`} style={{ width: `${shares[s.key]}%` }} />
            ))}
          </div>
          <figcaption className={`${styles.labels} mt-3`}>
            {shown.map((s) => (
              <span key={s.key} className={styles.label} style={{ '--share': `${shares[s.key]}%` } as CSSProperties}>
                <span className={`${styles.mark} ${s.tone}`} aria-hidden />
                <span className="text-[15px] font-medium text-pp-ink">
                  {calls[s.key].toLocaleString('en-US')} {s.label}
                </span>
                <span className="text-[13px] text-pp-muted">{shares[s.key]}%</span>
              </span>
            ))}
          </figcaption>
        </figure>
      )}

      <ul className="mt-6 flex flex-col lg:col-span-2 gap-x-8 gap-y-1.5 text-[15px] text-pp-muted sm:flex-row sm:flex-wrap sm:items-baseline">
        {counters.protected > 0 && (
          <li>
            <span className="font-medium text-pp-ink">{usd(counters.protected)}</span> kept from leaving the shop
          </li>
        )}
        {counters.moved > 0 && (
          <li>
            <span className="font-medium text-pp-ink">{usd(counters.moved)}</span> paid back to customers
          </li>
        )}
        {counters.billed > 0 && (
          <li>
            <span className="font-medium text-pp-ink">{usd(counters.billed)}</span> invoiced
          </li>
        )}
        <li>
          <Link href="/guard" className={styles.link}>
            {counters.awaiting === 0
              ? 'Open the guard log'
              : counters.awaiting === 1
                ? 'Review the held action'
                : `Review the ${counters.awaiting.toLocaleString('en-US')} held actions`}
          </Link>
        </li>
      </ul>
    </section>
  );
}
