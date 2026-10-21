'use client';

import { useActionState } from 'react';
import { createSamplePaymentsAction } from './actions';

// Charges fresh sandbox payments for the sample tickets: a refunded order can't be refunded twice.
export function SeedButton({ label }: { label: string }) {
  const [state, action, pending] = useActionState(createSamplePaymentsAction, null);
  return (
    <form action={action} className="flex items-center gap-3">
      <button
        type="submit"
        disabled={pending}
        className="rounded border border-pp-border bg-pp-surface px-3 py-1.5 text-sm font-semibold text-pp-navy hover:bg-pp-highlight disabled:opacity-60"
      >
        {pending ? 'Creating payments…' : label}
      </button>
      {state && <span className={`text-sm ${state.ok ? 'text-pp-muted' : 'text-pp-danger'}`}>{state.message}</span>}
    </form>
  );
}
