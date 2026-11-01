// Saved reports, kept in this browser's localStorage. Studio's state has no page names, so each
// report carries its page titles alongside the AG Studio state.
//
// The built-in report comes from ./studio/initial-report.ts, in the app's current language, until
// it is saved; after that the saved copy wins (in the language it was saved in) until it is reset
// to default, or until BUILT_IN_VERSION changes. Text comes from the dashboard's messages through
// `t` (./translate.ts).

import type { AgReportState } from 'ag-studio';
import { dashboardReport } from './studio/initial-report';
import type { Translate } from './translate';

export type SavedReport = {
  id: string;
  name: string;
  builtIn?: boolean;
  // The built-in report's BUILT_IN_VERSION when it was saved.
  version?: number;
  pageTitles: Record<string, string>;
  state: AgReportState;
  updatedAt: string;
};

export type StoredReports = { reports: SavedReport[]; activeId: string };

const STORAGE_KEY = 'ag-paypal-demo:reports:v1';

export const BUILT_IN_ID = 'paypal-overview';

// Bump when initial-report.ts changes in a way a saved built-in copy must not hide. A copy saved
// under another version is replaced by the code's report on load; reports people made are kept.
// 2: the payment guard page comes first.
// 3: redesign: "AI operations" cover and "Agent activity"; cash folded into "Revenue & cash".
// 4: control room: the cover's money figures move to the header; live feed; taller charts.
// 6: light dashboard: "Flow through the guard" cover, one fact per widget, one question per chart.
// 7: one labelled bar per day on "Decisions per day".
// 8: the report's text follows the app's language; copies saved in English before it are replaced.
const BUILT_IN_VERSION = 8;

// The built-in report's page ids in initial-report.ts; their sidebar titles are `report.pages.<id>`.
const BUILT_IN_PAGES = ['guard', 'activity', 'revenue', 'receivables', 'catalogue'];

// The parts of built-in reports made by defaultReport(), mapped to the name they were made with. A
// built-in report whose state and page titles are still these, under that name, was never edited:
// it isn't saved, so the next visit builds it again from code, in that visit's language.
const fromCode = new WeakMap<object, string>();

export function defaultReport(t: Translate): SavedReport {
  const name = t('report.name');
  const pageTitles = Object.fromEntries(BUILT_IN_PAGES.map((id) => [id, t(`report.pages.${id}`)]));
  const state = dashboardReport(t);
  fromCode.set(pageTitles, name).set(state, name);
  return {
    id: BUILT_IN_ID,
    name,
    builtIn: true,
    version: BUILT_IN_VERSION,
    pageTitles,
    state,
    updatedAt: new Date(0).toISOString(),
  };
}

// Whether `report` is the built-in report exactly as defaultReport() made it.
const untouched = (report: SavedReport) =>
  report.id === BUILT_IN_ID && fromCode.get(report.state) === report.name && fromCode.get(report.pageTitles) === report.name;

export const newId = (prefix: string) => `${prefix}-${crypto.randomUUID().slice(0, 8)}`;

export function blankReport(name: string, t: Translate): SavedReport {
  const pageId = newId('page');
  return {
    id: newId('report'),
    name,
    pageTitles: { [pageId]: t('reports.pageNumber', { number: 1 }) },
    state: { selectedPageId: pageId, pages: [{ id: pageId }] },
    updatedAt: new Date().toISOString(),
  };
}

// A copy of a report under a new id. Copies of the built-in report are ordinary reports.
export const copyOf = (source: SavedReport, t: Translate): SavedReport => ({
  ...source,
  id: newId('report'),
  name: t('reports.copyName', { name: source.name }),
  builtIn: undefined,
  updatedAt: new Date().toISOString(),
});

export const findReport = (reports: SavedReport[], id: string) => reports.find((r) => r.id === id);

// --- Updates ----------------------------------------------------------------------
// Pure: each returns the next StoredReports, for the caller to save.

export function upsert(current: StoredReports, report: SavedReport): StoredReports {
  const exists = current.reports.some((r) => r.id === report.id);
  const reports = exists ? current.reports.map((r) => (r.id === report.id ? report : r)) : [...current.reports, report];
  return { ...current, reports };
}

// Deleting the built-in report resets it to default rather than removing it.
export function remove(current: StoredReports, id: string, t: Translate): StoredReports {
  if (id === BUILT_IN_ID) return upsert(current, defaultReport(t));
  const reports = current.reports.filter((r) => r.id !== id);
  return { reports, activeId: current.activeId === id ? BUILT_IN_ID : current.activeId };
}

// Back to a fresh demo: only the built-in report, as defined in initial-report.ts.
export const initialReports = (t: Translate): StoredReports => ({ reports: [defaultReport(t)], activeId: BUILT_IN_ID });

// --- Storage ----------------------------------------------------------------------

export function loadReports(t: Translate): StoredReports {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return initialReports(t);
    const stored = JSON.parse(raw) as StoredReports;
    // The built-in report is always listed first, from code unless a saved copy exists.
    const reports = [
      stored.reports.find((r) => r.id === BUILT_IN_ID && r.version === BUILT_IN_VERSION) ?? defaultReport(t),
      ...stored.reports.filter((r) => r.id !== BUILT_IN_ID),
    ];
    const activeId = reports.some((r) => r.id === stored.activeId) ? stored.activeId : BUILT_IN_ID;
    return { reports, activeId };
  } catch {
    return initialReports(t);
  }
}

export function saveReports(next: StoredReports) {
  // Only keep the built-in report once it differs from code, so edits to initial-report.ts show up
  // and an unedited one is always shown in the current language.
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...next, reports: next.reports.filter((r) => !untouched(r)) }));
  } catch {
    // Storage full or blocked: keep working in memory for this session.
  }
}
