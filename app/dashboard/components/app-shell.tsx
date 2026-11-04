'use client';

import type { ReactNode } from 'react';
import styles from '../control-room/control-room.module.css';

// The dashboard frame inside the app's side menu: the reports panel (only while the menu is
// collapsed; otherwise the reports sit in the menu) and the canvas. On a phone the panel sits above
// the canvas instead of beside it. Shared by the dashboard, its
// loading skeleton and its error page. The frame is the dark "control room": `styles.room` swaps the
// design tokens for everything inside it (../control-room/control-room.module.css).

export function AppShell({
  sidebar,
  children,
}: {
  sidebar?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className={`${styles.room} flex min-h-full shrink-0 flex-col font-paypal text-pp-ink`}>
      <div className="flex flex-1 max-md:flex-col">
        {sidebar && (
          <nav className="flex shrink-0 flex-col border-pp-border bg-pp-surface max-md:border-b md:w-64 md:border-r" aria-label="Reports">
            {sidebar}
          </nav>
        )}
        <main className="flex min-w-0 flex-1 flex-col">{children}</main>
      </div>
    </div>
  );
}
