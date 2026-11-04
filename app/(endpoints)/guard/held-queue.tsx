'use client';

// Refunds, subscription cancellations, dispute acceptances, invoice actions and orders the payment guard held for a person,
// each with Approve and Reject. Approving runs the call through the guard's checks again before PayPal sees it.

import { useActionState, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Spinner } from '../../ui/desk';
import { decideHeldAction } from './actions';

// `environment`: a live hold runs on live PayPal, with real money, once approved.
export type HeldCall = { id: string; at: string; customer: string; codes: string[]; reasons: string; environment?: 'sandbox' | 'live' } & (
  | { kind: 'refund'; amount: string; captureId: string }
  | { kind: 'cancellation'; subscriptionId: string }
  | { kind: 'dispute'; disputeId: string }
  | { kind: 'invoice'; amount: string }
  | { kind: 'order'; amount: string }
  | { kind: 'invoice-sending' | 'invoice-reminder'; invoiceId: string }
);

// Message keys (guard.held.kinds) of each kind's title.
const TITLE = {
  refund: 'refund',
  cancellation: 'cancellation',
  dispute: 'dispute',
  invoice: 'invoice',
  order: 'order',
  'invoice-sending': 'invoiceSending',
  'invoice-reminder': 'invoiceReminder',
} as const;

// The id or amount that tells one held call from another of its kind.
function referenceOf(held: HeldCall): string {
  switch (held.kind) {
    case 'refund':
      return held.captureId;
    case 'cancellation':
      return held.subscriptionId;
    case 'dispute':
      return held.disputeId;
    case 'invoice':
    case 'order':
      return held.amount;
    default:
      return held.invoiceId;
  }
}

// A fixed locale and time zone, so the server's HTML and the browser's render show the same text.
const atUtc = (iso: string) => `${new Date(iso).toLocaleString('en-GB', { timeZone: 'UTC' })} UTC`;

// Message keys (guard.held.reasons) of the short labels for why the guard held a call (lib/guard:
// policy.ts and the intent judge). Any other code shows as itself.
const WHY: Record<string, string> = {
  APPROVAL_REQUIRED: 'approvalRequired',
  INTENT_UNCERTAIN: 'intentUncertain',
  INTENT_JUDGE_UNAVAILABLE: 'intentJudgeUnavailable',
};

const OUTCOME_STYLE: Record<string, string> = {
  executed: 'border-pp-success/40 bg-pp-success-tint text-pp-success',
  blocked: 'border-pp-danger/40 bg-pp-danger-tint text-pp-danger',
  error: 'border-pp-danger/40 bg-pp-danger-tint text-pp-danger',
  refused: 'border-pp-border bg-pp-surface text-pp-muted',
};

// How many held calls show before "Show all".
const FIRST = 5;

// The decision state lives in the queue, not in each item: a decided call leaves the list when
// the page refreshes, and its result must stay on screen after it does.
function HeldItem({ held, action, pending }: { held: HeldCall; action: (form: FormData) => void; pending: boolean }) {
  const t = useTranslations('guard.held');
  const amount = held.kind === 'refund' || held.kind === 'invoice' || held.kind === 'order' ? held.amount : null;
  return (
    <li className="border-b border-pp-gridline px-5 py-4 last:border-b-0">
      <form action={action} className="flex flex-wrap items-start gap-x-6 gap-y-3 text-sm">
        <input type="hidden" name="id" value={held.id} />
        <div className="min-w-0 flex-1 basis-64">
          <p className="text-[15px]">
            {t.rich('heading', {
              action: t(`kinds.${TITLE[held.kind]}`),
              hasAmount: amount ? 'yes' : 'no',
              amount: amount ?? '',
              customer: held.customer,
              strong: (chunks) => <span className="font-semibold">{chunks}</span>,
              muted: (chunks) => <span className="text-pp-muted">{chunks}</span>,
            })}
          </p>
          <p className="mt-0.5 text-xs text-pp-muted">
            {!amount && <code className="mr-2 font-mono">{referenceOf(held)}</code>}
            {atUtc(held.at)}
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            {held.environment === 'live' && (
              <span className="rounded-[3px] border border-pp-danger/40 bg-pp-danger-tint px-2 py-0.5 text-xs font-semibold text-pp-danger">{t('live')}</span>
            )}
            {[...new Set(held.codes)].map((code) => (
              <span key={code} className="rounded-[3px] border border-pp-warning/40 bg-pp-warning-tint px-2 py-0.5 text-xs font-semibold text-pp-warning">
                {WHY[code] ? t(`reasons.${WHY[code]}`) : code}
              </span>
            ))}
            <details className="text-xs text-pp-muted">
              <summary className="cursor-pointer select-none font-semibold text-pp-blue">{t('why')}</summary>
              <p className="mt-1 max-w-2xl">{held.reasons}</p>
            </details>
          </div>
        </div>
        <span className="flex shrink-0 gap-2">
          <button
            type="submit"
            name="decision"
            value="approve"
            disabled={pending}
            className="rounded-md bg-pp-blue px-4 py-1.5 font-semibold text-white hover:bg-pp-blue-dark disabled:opacity-50"
          >
            {t('approve')}
          </button>
          <button
            type="submit"
            name="decision"
            value="reject"
            disabled={pending}
            className="rounded-md border border-pp-border bg-pp-surface px-4 py-1.5 font-semibold text-pp-ink hover:border-pp-danger hover:text-pp-danger disabled:opacity-50"
          >
            {t('reject')}
          </button>
        </span>
      </form>
    </li>
  );
}

export function HeldQueue({ calls }: { calls: HeldCall[] }) {
  const [state, action, pending] = useActionState(decideHeldAction, null);
  const [all, setAll] = useState(false);
  const t = useTranslations('guard.held');
  const shown = all ? calls : calls.slice(0, FIRST);
  return (
    <section>
      <div className="flex items-baseline justify-between gap-4">
        <h2 className="text-lg font-semibold">{t('title')}</h2>
        <span className="flex items-center gap-2 text-sm text-pp-muted">
          {pending && <Spinner className="text-pp-blue" />}
          {pending ? t('running') : t('count', { count: calls.length })}
        </span>
      </div>
      <p className="mt-1 text-sm text-pp-muted">{t('intro')}</p>
      {state && <p className={`mt-3 rounded-md border px-4 py-2.5 text-sm font-semibold ${OUTCOME_STYLE[state.outcome]}`}>{state.message}</p>}
      {calls.length === 0 ? (
        <p className="mt-3 rounded-lg border border-pp-border bg-pp-surface px-5 py-6 text-sm text-pp-muted">{t('empty')}</p>
      ) : (
        <>
          <ul className="mt-3 overflow-hidden rounded-lg border border-pp-border bg-pp-surface">
            {shown.map((held) => (
              <HeldItem key={held.id} held={held} action={action} pending={pending} />
            ))}
          </ul>
          {calls.length > FIRST && (
            <button type="button" onClick={() => setAll(!all)} className="mt-3 text-sm font-semibold text-pp-blue hover:underline">
              {all ? t('showFirst', { count: FIRST }) : t('showAll', { count: calls.length })}
            </button>
          )}
        </>
      )}
    </section>
  );
}
