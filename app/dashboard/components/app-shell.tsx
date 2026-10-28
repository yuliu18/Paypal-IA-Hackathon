'use client';

import type { ReactNode } from 'react';
import styles from '../control-room/control-room.module.css';

// The dashboard frame inside the app's side menu: the reports panel (only while the menu is
// collapsed; otherwise the reports sit in the menu) and the canvas. Shared by the dashboard, its
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
      <div className="flex flex-1">
        {sidebar && (
          <nav className="flex w-64 shrink-0 flex-col border-r border-pp-border bg-pp-surface" aria-label="Reports">
            {sidebar}
          </nav>
        )}
        <main className="flex min-w-0 flex-1 flex-col">{children}</main>
      </div>
    </div>
  );
}
