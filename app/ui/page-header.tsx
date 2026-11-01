import type { ReactNode } from 'react';

// The top of every page: its name, one or two lines on what it is for, and an optional aside at
// the right (a status, downloads).
export function PageHeader({ title, children, aside }: { title: string; children?: ReactNode; aside?: ReactNode }) {
  return (
    <header className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3 border-b border-pp-border pb-5">
      <div className="max-w-2xl">
        <h1 className="text-[28px] font-semibold leading-tight tracking-[-0.01em] text-pp-ink">{title}</h1>
        {children && <div className="mt-1.5 text-[15px] leading-relaxed text-pp-muted">{children}</div>}
      </div>
      {aside}
    </header>
  );
}
