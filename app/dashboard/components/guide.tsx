'use client';

import type { ReactNode } from 'react';

// "How to use this dashboard": a panel at the right that stays open beside the report (no
// backdrop), so its steps can be followed while doing them. Names in bold are the labels on screen.

function Step({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="border-b border-pp-gridline py-4 last:border-b-0">
      <h3 className="text-sm font-semibold text-pp-ink">{title}</h3>
      <div className="mt-1.5 space-y-1.5 text-sm leading-relaxed text-pp-muted">{children}</div>
    </section>
  );
}

const B = ({ children }: { children: ReactNode }) => <strong className="font-semibold text-pp-ink">{children}</strong>;

export function GuidePanel({ open, onClose, aiEnabled }: { open: boolean; onClose: () => void; aiEnabled: boolean }) {
  if (!open) return null;
  return (
    <aside
      aria-label="How to use this dashboard"
      className="fixed inset-y-0 right-0 z-40 flex w-full max-w-[400px] flex-col border-l border-pp-border bg-pp-surface font-paypal text-pp-ink shadow-[-8px_0_24px_rgba(11,31,68,0.08)]"
    >
      <header className="flex items-start justify-between gap-4 border-b border-pp-border px-5 py-4">
        <div>
          <h2 className="text-base font-semibold">How to use this dashboard</h2>
          <p className="mt-0.5 text-sm text-pp-muted">Built with AG Studio. Keep this open while you try each step.</p>
        </div>
        <button type="button" onClick={onClose} aria-label="Close the guide" className="rounded-md p-1.5 text-pp-muted hover:bg-pp-canvas hover:text-pp-ink">
          <svg viewBox="0 0 24 24" className="size-4 fill-none stroke-current" strokeWidth={2} strokeLinecap="round" aria-hidden>
            <path d="M6 6l12 12M18 6 6 18" />
          </svg>
        </button>
      </header>
      <div className="flex-1 overflow-y-auto px-5">
        <Step title="Read a page">
          <p>
            Each widget answers one question; its title says which. Point at a bar or a band to see its numbers.
          </p>
        </Step>
        <Step title="Filter by clicking">
          <p>
            Click an agent in <B>Flow through the guard</B>, or a bar in a chart, and every other widget on the page shows only that. Click it
            again to clear it.
          </p>
          <p>
            Open <B>Filters</B> at the right edge for the page&apos;s filters and the ones you clicked.
          </p>
        </Step>
        <Step title="Move between pages and reports">
          <p>
            The pages of the open report are listed in the left menu under <B>Dashboard</B>. <B>Add page</B> adds an empty one; double-click a
            page or a report to rename it.
          </p>
          <p>
            <B>New report</B> starts a blank report. A report&apos;s <B>⋯</B> menu has <B>Rename</B>, <B>Duplicate</B> and delete.{' '}
            <B>Reset demo</B> brings back the built-in report and removes the ones you made.
          </p>
        </Step>
        <Step title="Edit a page">
          <p>
            Press <B>Edit</B>. Two panels open at the right: <B>Compose</B> and <B>Data</B>.
          </p>
          <p>
            <B>Add a widget:</B> in <B>Compose</B>, open <B>Widgets</B> and drag one onto the page. Or drag a field from <B>Data</B> (an agent, a
            customer, an amount) onto the page and Studio makes a chart of it.
          </p>
          <p>
            <B>Change a widget:</B> click it. Its setup shows in <B>Compose</B>: chart type, the fields on each axis, sorting and its titles.
          </p>
          <p>
            <B>Move or resize:</B> drag a widget to move it, or drag its edges to resize it. Its toolbar duplicates or deletes it.
          </p>
          <p>
            Undo and redo are next to <B>Save</B>. <B>Save</B> keeps the report in this browser; <B>Discard</B> drops the changes; <B>View</B>{' '}
            leaves editing.
          </p>
        </Step>
        <Step title="Add the guard's own widget">
          <p>
            In <B>Compose</B> › <B>Widgets</B>, the <B>Payment guard</B> group has <B>Flow through the guard</B>: every agent&apos;s calls through
            the guard to what it did. Drag it onto any page.
          </p>
        </Step>
        <Step title="Export">
          <p>A table or chart&apos;s toolbar downloads its rows as CSV, or the chart as an image.</p>
        </Step>
        <Step title="Ask the AI">
          {aiEnabled ? (
            <p>
              In <B>Edit</B>, open the <B>AI Assistant</B> and describe the widget you want, for example &ldquo;stopped refunds by customer&rdquo;.
              It builds it on the page, and you keep or discard it like any other change.
            </p>
          ) : (
            <p>
              The <B>AI Assistant</B> builds widgets from a sentence. It appears in Edit mode once an OpenAI key is set on the server (see the
              README).
            </p>
          )}
        </Step>
      </div>
    </aside>
  );
}
