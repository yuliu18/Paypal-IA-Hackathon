'use client';

// Refunds the payment guard held for a person, each with Approve and Reject. Approving runs the
// refund through the guard's checks again before PayPal sees it.

import { useActionState } from 'react';
import { decideHeldAction } from './actions';

export type HeldRefund = { id: string; at: string; customer: string; amount: string; captureId: string; codes: string[]; reasons: string };

// A fixed locale and time zone, so the server's HTML and the browser's render show the same text.
const atUtc = (iso: string) => `${new Date(iso).toLocaleString('en-GB', { timeZone: 'UTC' })} UTC`;

// Short labels for why the guard held a refund (lib/guard: policy.ts and the intent judge).
const WHY: Record<string, string> = {
  APPROVAL_REQUIRED: 'Over the approval limit',
  INTENT_UNCERTAIN: 'AI judge unsure',
  INTENT_JUDGE_UNAVAILABLE: 'AI judge unavailable',
};

const OUTCOME_STYLE: Record<string, string> = {
  executed: 'text-pp-success',
  blocked: 'text-pp-danger',
  error: 'text-pp-danger',
  refused: 'text-pp-muted',
};

// The decision state lives in the queue, not in each item: a decided refund leaves the list when
// the page refreshes, and its result must stay on screen after it does.
function HeldItem({ refund, action, pending }: { refund: HeldRefund; action: (form: FormData) => void; pending: boolean }) {
  return (
    <li className="rounded-lg border border-pp-border bg-pp-surface px-5 py-4">
      <form action={action} className="flex flex-wrap items-center gap-x-6 gap-y-3 text-sm">
        <input type="hidden" name="id" value={refund.id} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
            <span className="text-lg font-semibold text-pp-navy">{refund.amount}</span>
            <span>{refund.customer}</span>
            <code className="text-xs text-pp-muted">{refund.captureId}</code>
            <span className="text-xs text-pp-muted">{atUtc(refund.at)}</span>
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            {[...new Set(refund.codes)].map((code) => (
              <span key={code} className="rounded-full bg-pp-warning/10 px-2.5 py-0.5 text-xs font-semibold text-pp-warning">
                {WHY[code] ?? code}
              </span>
            ))}
            <details className="text-xs text-pp-muted">
              <summary className="cursor-pointer select-none font-semibold text-pp-blue">Why</summary>
              <p className="mt-1 max-w-3xl">{refund.reasons}</p>
            </details>
          </div>
        </div>
        <span className="flex shrink-0 gap-2">
          <button
            type="submit"
            name="decision"
            value="approve"
            disabled={pending}
            className="rounded bg-pp-blue px-4 py-1.5 font-semibold text-white hover:bg-pp-blue-dark disabled:opacity-50"
          >
            Approve
          </button>
          <button
            type="submit"
            name="decision"
            value="reject"
            disabled={pending}
            className="rounded border border-pp-border px-4 py-1.5 font-semibold text-pp-navy hover:bg-pp-highlight disabled:opacity-50"
          >
            Reject
          </button>
        </span>
      </form>
    </li>
  );
}

export function HeldQueue({ refunds }: { refunds: HeldRefund[] }) {
  const [state, action, pending] = useActionState(decideHeldAction, null);
  return (
    <section className="mt-5">
      <h2 className="text-lg font-semibold text-pp-navy">Waiting for approval ({refunds.length})</h2>
      {state && <p className={`mt-1 text-sm ${OUTCOME_STYLE[state.outcome]}`}>{state.message}</p>}
      {refunds.length === 0 ? (
        <p className="mt-1 text-sm text-pp-muted">No refunds are held right now.</p>
      ) : (
        <ul className="mt-2 flex flex-col gap-2">
          {refunds.map((refund) => (
            <HeldItem key={refund.id} refund={refund} action={action} pending={pending} />
          ))}
        </ul>
      )}
    </section>
  );
}
