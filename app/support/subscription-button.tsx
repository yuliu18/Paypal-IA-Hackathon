'use client';

import { useTranslations } from 'next-intl';
import { useActionState } from 'react';
import { secondaryButton, Spinner } from '../ui/desk';
import { createSampleSubscriptionAction } from './actions';

const linkClass = 'font-semibold text-pp-blue hover:underline';

// Creates the sample subscription for the cancellation tickets. It only becomes cancellable once a
// sandbox buyer approves it, so the approval link stays on the page until then (`pendingApproveUrl`).
export function SubscriptionButton({ pendingApproveUrl }: { pendingApproveUrl?: string }) {
  const t = useTranslations('desks.subscription');
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
        {pending ? t('creating') : t('create')}
      </button>
      <p className="text-sm text-pp-muted">{t('hint')}</p>
      {state && !state.ok && <span className="text-sm text-pp-danger">{state.message}</span>}
      {approveUrl && (
        <span className="text-sm text-pp-ink">
          {t.rich('approvalLink', {
            link: (chunks) => (
              <a href={approveUrl} target="_blank" rel="noopener noreferrer" className={linkClass}>
                {chunks}
              </a>
            ),
          })}
        </span>
      )}
    </form>
  );
}
