'use client';

// Refunds the payment guard held for a person, each with Approve and Reject. Approving runs the
// refund through the guard's checks again before PayPal sees it.

import { useActionState } from 'react';
import { decideHeldAction } from './actions';

export type HeldRefund = { id: string; at: string; customer: string; amount: string; captureId: string; reasons: string };

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
    <li className="rounded border border-pp-border bg-pp-surface px-4 py-3">
      <form action={action} className="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm">
        <input type="hidden" name="id" value={refund.id} />
        <span className="font-semibold text-pp-navy">{refund.amount}</span>
        <span>{refund.customer}</span>
        <code className="text-pp-muted">{refund.captureId}</code>
        <span className="text-pp-muted">{new Date(refund.at).toLocaleString()}</span>
        <span className="flex-1 text-pp-warning">{refund.reasons}</span>
        <span className="flex gap-2">
          <button
            type="submit"
            name="decision"
            value="approve"
            disabled={pending}
            className="rounded bg-pp-blue px-3 py-1 font-semibold text-white disabled:opacity-50"
          >
            Approve
          </button>
          <button
            type="submit"
            name="decision"
            value="reject"
            disabled={pending}
            className="rounded border border-pp-border px-3 py-1 font-semibold text-pp-navy disabled:opacity-50"
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
