'use client';

import type { ReactNode } from 'react';

// The dashboard frame inside the app's side menu: the reports panel (only while the menu is
// collapsed; otherwise the reports sit in the menu) and the canvas, styled like the other pages. Shared by the dashboard, its loading skeleton and its error page.

export function AppShell({
  sidebar,
  children,
}: {
  sidebar?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="flex min-h-full shrink-0 flex-col bg-pp-canvas font-paypal text-pp-ink">
      <div className="flex flex-1">
        {sidebar && (
          <nav className="flex w-64 shrink-0 flex-col border-r border-pp-border bg-white" aria-label="Reports">
            {sidebar}
          </nav>
        )}
        <main className="flex min-w-0 flex-1 flex-col">{children}</main>
      </div>
    </div>
  );
}
