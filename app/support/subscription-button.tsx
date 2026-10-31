'use client';

import { useActionState } from 'react';
import { secondaryButton, Spinner } from '../ui/desk';
import { createSampleSubscriptionAction } from './actions';

const linkClass = 'font-semibold text-pp-blue hover:underline';

// Creates the sample subscription for the cancellation tickets. It only becomes cancellable once a
// sandbox buyer approves it, so the approval link stays on the page until then (`pendingApproveUrl`).
export function SubscriptionButton({ pendingApproveUrl }: { pendingApproveUrl?: string }) {
  const [state, action, pending] = useActionState(createSampleSubscriptionAction, null);
  const approveUrl = state?.ok ? state.approveUrl : pendingApproveUrl;
  return (
    <form action={action} className="flex flex-col items-start gap-2.5 px-5 py-4">
      <button
        type="submit"
        disabled={pending}
        className={secondaryButton}
      >
        {pending && <Spinner className="text-pp-blue" />}
        {pending ? 'Creating subscription…' : 'Create sample subscription'}
      </button>
      <p className="text-sm text-pp-muted">A subscription a sandbox buyer approves, for the cancellation tickets.</p>
      {state && !state.ok && <span className="text-sm text-pp-danger">{state.message}</span>}
      {approveUrl && (
        <span className="text-sm text-pp-ink">
          <a href={approveUrl} target="_blank" rel="noopener noreferrer" className={linkClass}>
            Approval link
          </a>
          : open it and approve with your sandbox personal account, then come back.
        </span>
      )}
    </form>
  );
}
