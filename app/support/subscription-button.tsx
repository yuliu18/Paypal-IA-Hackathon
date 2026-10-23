'use client';

import { useActionState } from 'react';
import { createSampleSubscriptionAction } from './actions';

const linkClass = 'font-semibold text-pp-blue hover:underline';

// Creates the sample subscription for the cancellation tickets. It only becomes cancellable once a
// sandbox buyer approves it, so the approval link stays on the page until then (`pendingApproveUrl`).
export function SubscriptionButton({ pendingApproveUrl }: { pendingApproveUrl?: string }) {
  const [state, action, pending] = useActionState(createSampleSubscriptionAction, null);
  const approveUrl = state?.ok ? state.approveUrl : pendingApproveUrl;
  return (
    <form action={action} className="flex flex-wrap items-center gap-3">
      <button
        type="submit"
        disabled={pending}
        className="rounded border border-pp-border bg-pp-surface px-3 py-1.5 text-sm font-semibold text-pp-navy hover:bg-pp-highlight disabled:opacity-60"
      >
        {pending ? 'Creating subscription…' : 'Create sample subscription'}
      </button>
      {state && !state.ok && <span className="text-sm text-pp-danger">{state.message}</span>}
      {approveUrl && (
        <span className="text-sm text-pp-muted">
          <a href={approveUrl} target="_blank" rel="noopener noreferrer" className={linkClass}>
            Approval link
          </a>
          : open it and approve with your sandbox personal account, then come back.
        </span>
      )}
    </form>
  );
}
