import type { ReactNode } from 'react';
import { BrandMark } from '../ui/brand-mark';

// The look the sign-in and password-recovery pages share: the brand above one white card, no menu.

export const fieldClass = 'rounded-md border border-pp-border bg-pp-surface px-3 py-2 text-[15px] font-normal text-pp-ink';
export const labelClass = 'flex flex-col gap-1.5 text-sm font-semibold';
export const buttonClass = 'mt-2 inline-flex items-center justify-center rounded-md bg-pp-blue px-4 py-2.5 text-sm font-semibold text-white hover:bg-pp-blue-dark';
export const linkClass = 'text-sm font-semibold text-pp-blue hover:underline';

export const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);

export function AuthCard({ title, intro, error, notice, children }: { title: string; intro: string; error?: string; notice?: string; children: ReactNode }) {
  return (
    <main className="flex min-h-full items-center justify-center px-4 py-10 font-paypal text-pp-ink">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex items-center justify-center gap-2.5 font-semibold">
          <BrandMark className="size-8" />
          <span className="text-lg">Payment Guard</span>
        </div>
        <div className="rounded-lg border border-pp-border bg-pp-surface p-6 shadow-sm sm:p-8">
          <h1 className="text-[22px] font-semibold leading-tight tracking-[-0.01em]">{title}</h1>
          <p className="mt-1.5 text-[15px] leading-relaxed text-pp-muted">{intro}</p>
          {notice && (
            <p role="status" className="mt-5 rounded-md border border-pp-success/30 bg-pp-success-tint px-3 py-2 text-sm text-pp-success">
              {notice}
            </p>
          )}
          {error && (
            <p role="alert" className="mt-5 rounded-md border border-pp-danger/30 bg-pp-danger-tint px-3 py-2 text-sm text-pp-danger">
              {error}
            </p>
          )}
          {children}
        </div>
      </div>
    </main>
  );
}
