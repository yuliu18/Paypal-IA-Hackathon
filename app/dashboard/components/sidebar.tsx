'use client';

import { useState } from 'react';
import { CloseIcon, MoreIcon, PlusIcon, RefreshIcon, ReportIcon } from './ui/icons';
import { pagesFor, type ReportPage } from '../page-titles';
import type { SavedReport } from '../reports-store';
import { Button, Menu, MenuItem } from './ui/ui';

// Reports, each listing its pages. The open report shows its live pages (including unsaved
// ones); the others show their saved pages. Double-click a report or page to rename it.
// `tone`: `panel` in the dashboard's own panel, `menu` nested inside the app's side menu.

const TONES = {
  panel: {
    title: 'px-6 pb-2 pt-6 text-xs font-semibold uppercase tracking-wider text-pp-muted',
    list: 'flex-1 space-y-1 overflow-y-auto px-3 pb-4',
    report: (active: boolean) => (active ? 'font-semibold text-pp-navy' : 'text-pp-ink hover:bg-pp-canvas'),
    reportIcon: 'text-pp-blue',
    more: 'text-pp-muted hover:bg-pp-surface hover:text-pp-navy',
    pages: 'border-pp-border',
    page: (selected: boolean) => (selected ? 'bg-pp-highlight font-semibold text-pp-blue' : 'text-pp-muted hover:bg-pp-canvas hover:text-pp-navy'),
    remove: 'text-pp-muted hover:bg-pp-surface hover:text-pp-danger',
    add: 'text-pp-blue hover:bg-pp-highlight',
    footer: 'border-t border-pp-border p-4',
    note: 'text-pp-muted',
    reset: 'text-pp-blue',
  },
  menu: {
    title: 'sr-only',
    list: 'space-y-0.5 pb-1 pl-3',
    report: (active: boolean) => (active ? 'font-semibold text-pp-ink' : 'text-pp-muted hover:bg-pp-canvas hover:text-pp-ink'),
    reportIcon: 'text-pp-blue',
    more: 'text-pp-muted hover:bg-pp-canvas hover:text-pp-ink',
    pages: 'border-pp-border',
    page: (selected: boolean) => (selected ? 'bg-pp-highlight font-semibold text-pp-blue' : 'text-pp-muted hover:bg-pp-canvas hover:text-pp-ink'),
    remove: 'text-pp-muted hover:bg-pp-canvas hover:text-pp-danger',
    add: 'text-pp-muted hover:bg-pp-canvas hover:text-pp-ink',
    footer: 'space-y-0.5 pb-2 pl-3',
    note: 'text-pp-muted',
    reset: 'text-pp-muted',
  },
};
export function ReportsSidebar({
  reports,
  activeId,
  activePages,
  selectedPageId,
  editing,
  ready,
  onSelectReport,
  onSelectPage,
  onAddPage,
  onRemovePage,
  onRenamePage,
  onRenameReport,
  onCreate,
  onDuplicate,
  onDelete,
  onReset,
  tone = 'panel',
}: {
  tone?: keyof typeof TONES;
  reports: SavedReport[];
  activeId: string;
  activePages: ReportPage[];
  selectedPageId: string;
  editing: boolean;
  ready: boolean;
  onSelectReport: (id: string) => void;
  onSelectPage: (reportId: string, pageId: string) => void;
  onAddPage: () => string | undefined;
  onRemovePage: (pageId: string) => void;
  onRenamePage: (pageId: string, title: string) => void;
  onRenameReport: (reportId: string, name: string) => void;
  onCreate: () => void;
  onDuplicate: (id: string) => void;
  onDelete: (id: string) => void;
  onReset: () => void;
}) {
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const t = TONES[tone];

  const finishRename = (value: string, commit: (title: string) => void) => {
    setRenaming(null);
    if (value.trim()) commit(value.trim());
  };

  return (
    <>
      <p className={t.title}>Reports</p>
      <ul className={t.list}>
        {reports.map((report) => {
          const active = report.id === activeId;
          const open = expanded[report.id] ?? active;
          const pages = active ? activePages : pagesFor(report);

          return (
            <li key={report.id}>
              <div className="group relative">
                {renaming === report.id ? (
                  <RenameInput
                    value={report.name}
                    label="Report name"
                    className="ml-1 w-[calc(100%-8px)] py-2 text-[15px]"
                    onDone={(value) => finishRename(value, (name) => onRenameReport(report.id, name))}
                    onCancel={() => setRenaming(null)}
                  />
                ) : (
                  <button
                    type="button"
                    disabled={!ready}
                    onClick={() => {
                      if (active) setExpanded((current) => ({ ...current, [report.id]: !open }));
                      else {
                        setExpanded((current) => ({ ...current, [report.id]: true }));
                        onSelectReport(report.id);
                      }
                    }}
                    onDoubleClick={() => setRenaming(report.id)}
                    aria-expanded={open}
                    className={`flex w-full items-center pr-10 text-left transition-colors ${
                      tone === 'menu' ? 'gap-2.5 rounded px-2 py-1.5 text-sm' : 'gap-3 rounded-full py-2.5 pl-4 text-[15px]'
                    } ${t.report(active)}`}
                  >
                    <ReportIcon className={`${tone === 'menu' ? 'size-4' : 'size-5'} shrink-0 ${active ? t.reportIcon : ''}`} />
                    <span className="truncate">{report.name}</span>
                  </button>
                )}
                <div className="absolute right-1 top-1/2 -translate-y-1/2">
                  <button
                    type="button"
                    aria-label={`Actions for ${report.name}`}
                    aria-haspopup="menu"
                    aria-expanded={menuFor === report.id}
                    onClick={() => setMenuFor(menuFor === report.id ? null : report.id)}
                    className={`flex size-8 items-center justify-center rounded-full ${t.more} ${
                      menuFor === report.id ? 'opacity-100' : 'opacity-0 focus-visible:opacity-100 group-hover:opacity-100'
                    }`}
                  >
                    <MoreIcon />
                  </button>
                  <Menu open={menuFor === report.id} onClose={() => setMenuFor(null)}>
                    <MenuItem
                      onClick={() => {
                        setMenuFor(null);
                        setRenaming(report.id);
                      }}
                    >
                      Rename
                    </MenuItem>
                    <MenuItem
                      onClick={() => {
                        setMenuFor(null);
                        onDuplicate(report.id);
                      }}
                    >
                      Duplicate
                    </MenuItem>
                    <MenuItem
                      danger
                      onClick={() => {
                        setMenuFor(null);
                        onDelete(report.id);
                      }}
                    >
                      {report.builtIn ? 'Reset to default' : 'Delete'}
                    </MenuItem>
                  </Menu>
                </div>
              </div>

              {open && (
                <ul className={`mb-2 mt-1 space-y-0.5 border-l ${tone === 'menu' ? 'ml-4 pl-2' : 'ml-[26px] pl-3'} ${t.pages}`} aria-label={`${report.name} pages`}>
                  {pages.map((page) => {
                    const selected = active && page.id === selectedPageId;
                    return (
                      <li key={page.id} className="group relative">
                        {renaming === page.id ? (
                          <RenameInput
                            value={page.title}
                            label="Page name"
                            className="w-full py-1.5 text-sm"
                            onDone={(value) => finishRename(value, (title) => onRenamePage(page.id, title))}
                            onCancel={() => setRenaming(null)}
                          />
                        ) : (
                          <button
                            type="button"
                            disabled={!ready}
                            onClick={() => onSelectPage(report.id, page.id)}
                            onDoubleClick={() => active && editing && setRenaming(page.id)}
                            aria-current={selected ? 'page' : undefined}
                            title={active && editing ? 'Double-click to rename' : undefined}
                            className={`block w-full truncate pr-8 text-left text-sm transition-colors ${tone === 'menu' ? 'rounded px-2 py-1.5' : 'rounded-full py-2 pl-4'} ${t.page(selected)}`}
                          >
                            {page.title}
                          </button>
                        )}
                        {active && editing && pages.length > 1 && renaming !== page.id && (
                          <button
                            type="button"
                            aria-label={`Remove page ${page.title}`}
                            title="Remove page"
                            onClick={() => onRemovePage(page.id)}
                            className={`absolute right-1.5 top-1/2 flex size-6 -translate-y-1/2 items-center justify-center rounded-full opacity-0 focus-visible:opacity-100 group-hover:opacity-100 ${t.remove}`}
                          >
                            <CloseIcon className="size-3.5" />
                          </button>
                        )}
                      </li>
                    );
                  })}
                  {active && (
                    <li>
                      <button
                        type="button"
                        disabled={!ready}
                        onClick={() => {
                          const id = onAddPage();
                          if (id) setRenaming(id);
                        }}
                        className={`flex w-full items-center text-left text-sm ${tone === 'menu' ? 'gap-2.5 rounded px-2 py-1.5' : 'gap-1.5 rounded-full py-2 pl-4 font-semibold'} ${t.add}`}
                      >
                        <PlusIcon className="size-4" /> Add page
                      </button>
                    </li>
                  )}
                </ul>
              )}
            </li>
          );
        })}
      </ul>
      {tone === 'menu' ? (
        // In the side menu: plain menu entries, like the rest of the menu.
        <div className={t.footer}>
          <button type="button" onClick={onCreate} className={`flex w-full items-center gap-2.5 rounded px-2 py-1.5 text-left text-sm ${t.add}`}>
            <PlusIcon className="size-4" /> New report
          </button>
          <button
            type="button"
            onClick={onReset}
            disabled={!ready}
            title="Reports are saved in this browser. Reset brings back the demo reports."
            className={`flex w-full items-center gap-2.5 rounded px-2 py-1.5 text-left text-sm ${t.add}`}
          >
            <RefreshIcon className="size-4" /> Reset demo
          </button>
        </div>
      ) : (
        <div className={t.footer}>
          <Button variant="primary" className="w-full" onClick={onCreate}>
            <PlusIcon /> New report
          </Button>
          <p className={`mt-2 text-center text-xs ${t.note}`}>
            Reports are saved in this browser.{' '}
            <button type="button" onClick={onReset} disabled={!ready} className={`font-semibold hover:underline ${t.reset}`}>
              Reset demo
            </button>
          </p>
        </div>
      )}
    </>
  );
}

// Studio moves focus when the selected page changes, so focus on the next frame.
const focusAndSelect = (input: HTMLInputElement | null) => {
  if (!input) return;
  requestAnimationFrame(() => {
    input.focus();
    input.select();
  });
};

function RenameInput({
  value,
  label,
  className,
  onDone,
  onCancel,
}: {
  value: string;
  label: string;
  className: string;
  onDone: (value: string) => void;
  onCancel: () => void;
}) {
  return (
    <input
      ref={focusAndSelect}
      defaultValue={value}
      aria-label={label}
      onBlur={(e) => onDone(e.currentTarget.value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') e.currentTarget.blur();
        if (e.key === 'Escape') onCancel();
      }}
      className={`rounded-full border border-pp-blue bg-pp-surface px-4 font-semibold text-pp-navy outline-none ${className}`}
    />
  );
}
