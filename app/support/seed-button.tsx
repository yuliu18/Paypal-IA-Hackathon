'use client';

import { useActionState } from 'react';
import { secondaryButton, Spinner } from '../ui/desk';
import { createSamplePaymentsAction } from './actions';

// Charges fresh sandbox payments for the sample tickets: a refunded order can't be refunded twice.
export function SeedButton({ label }: { label: string }) {
  const [state, action, pending] = useActionState(createSamplePaymentsAction, null);
  return (
    <form action={action} className="flex flex-col items-start gap-2.5 px-5 py-4">
      <button
        type="submit"
        disabled={pending}
        className={secondaryButton}
      >
        {pending && <Spinner className="text-pp-blue" />}
        {pending ? 'Creating payments…' : label}
      </button>
      <p className="text-sm text-pp-muted">Three card payments, one per sample customer. Make new ones once the old ones are refunded.</p>
      {state && <span className={`text-sm ${state.ok ? 'text-pp-muted' : 'text-pp-danger'}`}>{state.message}</span>}
    </form>
  );
}
