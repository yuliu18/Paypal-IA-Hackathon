'use client';

import { useTranslations } from 'next-intl';
import { useActionState } from 'react';
import { secondaryButton, Spinner } from '../ui/desk';
import { createSampleDisputePaymentAction } from './actions';

const linkClass = 'font-semibold text-pp-blue hover:underline';

// Where the sample PayPal payment stands, as the page read it from the seed and PayPal.
export type DisputePaymentStep = { step: 'none' } | { step: 'unpaid'; approveUrl: string } | { step: 'paid' } | { step: 'disputed'; disputeId: string; status: string };

// Creates the sample PayPal payment for the dispute tickets, and says what the sandbox buyer does
// next: pay it, then open a dispute on it in the sandbox Resolution Center.
export function DisputePaymentButton({ payment }: { payment: DisputePaymentStep }) {
  const t = useTranslations('desks.disputePayment');
  const [state, action, pending] = useActionState(createSampleDisputePaymentAction, null);
  const approveUrl = state?.ok ? state.approveUrl : payment.step === 'unpaid' ? payment.approveUrl : undefined;
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
      {approveUrl ? (
        <span className="text-sm text-pp-ink">
          {t.rich('paymentLink', {
            link: (chunks) => (
              <a href={approveUrl} target="_blank" rel="noopener noreferrer" className={linkClass}>
                {chunks}
              </a>
            ),
          })}
        </span>
      ) : payment.step === 'paid' ? (
        <span className="text-sm text-pp-ink">
          {t.rich('paid', {
            link: (chunks) => (
              <a href="https://www.sandbox.paypal.com/myaccount/activities" target="_blank" rel="noopener noreferrer" className={linkClass}>
                {chunks}
              </a>
            ),
          })}
        </span>
      ) : payment.step === 'disputed' ? (
        <span className="text-sm text-pp-ink">
          {t.rich('disputed', {
            id: payment.disputeId,
            status: payment.status.toLowerCase().replaceAll('_', ' '),
            code: (chunks) => <code>{chunks}</code>,
          })}
        </span>
      ) : null}
    </form>
  );
}
