'use client';

import { useActionState } from 'react';
import { secondaryButton, Spinner } from '../ui/desk';
import { createSampleDisputePaymentAction } from './actions';

const linkClass = 'font-semibold text-pp-blue hover:underline';

// Where the sample PayPal payment stands, as the page read it from the seed and PayPal.
export type DisputePaymentStep = { step: 'none' } | { step: 'unpaid'; approveUrl: string } | { step: 'paid' } | { step: 'disputed'; disputeId: string; status: string };

// Creates the sample PayPal payment for the dispute tickets, and says what the sandbox buyer does
// next: pay it, then open a dispute on it in the sandbox Resolution Center.
export function DisputePaymentButton({ payment }: { payment: DisputePaymentStep }) {
  const [state, action, pending] = useActionState(createSampleDisputePaymentAction, null);
  const approveUrl = state?.ok ? state.approveUrl : payment.step === 'unpaid' ? payment.approveUrl : undefined;
  return (
    <form action={action} className="flex flex-col items-start gap-2 px-4 py-3">
      <p className="text-sm text-pp-muted">A 20 USD PayPal payment the buyer pays and then disputes, for the dispute tickets.</p>
      <button
        type="submit"
        disabled={pending}
        className={secondaryButton}
      >
        {pending && <Spinner className="text-pp-blue" />}
        {pending ? 'Creating payment…' : 'Create sample PayPal payment'}
      </button>
      {state && !state.ok && <span className="text-sm text-pp-danger">{state.message}</span>}
      {approveUrl ? (
        <span className="text-sm text-pp-muted">
          <a href={approveUrl} target="_blank" rel="noopener noreferrer" className={linkClass}>
            Payment link
          </a>
          : pay it with your sandbox personal account; PayPal brings you back here.
        </span>
      ) : payment.step === 'paid' ? (
        <span className="text-sm text-pp-muted">
          Paid. Now open a dispute on it: log in to{' '}
          <a href="https://www.sandbox.paypal.com/myaccount/activities" target="_blank" rel="noopener noreferrer" className={linkClass}>
            sandbox.paypal.com
          </a>{' '}
          as the buyer, open the 20 USD payment to Guard demo shop and report a problem, then reload this page.
        </span>
      ) : payment.step === 'disputed' ? (
        <span className="text-sm text-pp-muted">
          Dispute <code>{payment.disputeId}</code> is {payment.status.toLowerCase().replaceAll('_', ' ')}.
        </span>
      ) : null}
    </form>
  );
}
