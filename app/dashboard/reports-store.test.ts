import { createTranslator } from 'next-intl';
import { afterEach, describe, expect, it, vi } from 'vitest';
import en from '@/messages/en/dashboard.json';
import es from '@/messages/es/dashboard.json';
import { BUILT_IN_ID, defaultReport, initialReports, loadReports, saveReports, type SavedReport } from './reports-store';
import type { Translate } from './translate';

// The dashboard's translator in one language, with keys as plain strings.
function dashboardIn(locale: string, dashboard: typeof en): Translate {
  const t = createTranslator({ locale, messages: { dashboard }, namespace: 'dashboard' });
  return (key, values) => t(key as Parameters<typeof t>[0], values);
}

const english = dashboardIn('en', en);
const spanish = dashboardIn('es', es);

const storeWith = (reports: SavedReport[]) => {
  const raw = JSON.stringify({ reports, activeId: BUILT_IN_ID });
  vi.stubGlobal('localStorage', { getItem: () => raw, setItem: () => {} });
};

// localStorage kept in memory, so a save can be read back by the next load.
const memoryStorage = () => {
  const items = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => items.get(key) ?? null,
    setItem: (key: string, value: string) => items.set(key, value),
  });
};

afterEach(() => vi.unstubAllGlobals());

describe('loadReports', () => {
  it('opens the built-in report on the payment guard page', () => {
    expect(defaultReport(english).state.selectedPageId).toBe('guard');
    expect(defaultReport(english).state.pages[0].id).toBe('guard');
  });

  it('lists the AI agents first, then the PayPal pages, each with a title', () => {
    // The empty "Cash & payouts" page went: the sandbox has no payouts, and the balance now sits on "Revenue & cash".
    const report = defaultReport(english);
    expect(report.state.pages.map((p) => report.pageTitles[p.id])).toEqual([
      'AI operations',
      'Agent activity',
      'Revenue & cash',
      'Receivables',
      'Catalogue',
    ]);
  });

  it('keeps a saved copy of the current built-in report', () => {
    const edited = { ...defaultReport(english), name: 'My overview' };
    storeWith([edited]);
    expect(loadReports(english).reports[0].name).toBe('My overview');
  });

  it('replaces a built-in report saved before its pages changed, and keeps the reports people made', () => {
    const previous: SavedReport = { ...defaultReport(english), name: 'Saved under version 2', version: 2 };
    storeWith([previous]);
    expect(loadReports(english).reports[0].name).toBe(defaultReport(english).name);
  });

  it('replaces a built-in report saved before reports carried a version', () => {
    // Saved before reports carried a version.
    const stale: SavedReport = { ...defaultReport(english), name: 'Old overview', version: undefined };
    const mine: SavedReport = { ...defaultReport(english), id: 'report-1', builtIn: undefined, name: 'Mine' };
    storeWith([stale, mine]);
    const { reports } = loadReports(english);
    expect(reports.map((r) => r.name)).toEqual([defaultReport(english).name, 'Mine']);
  });
});

describe('the built-in report and the app language', () => {
  it('builds the built-in report in the language it is given', () => {
    const report = defaultReport(spanish);
    expect(report.name).toBe(es.report.name);
    expect(report.pageTitles.guard).toBe(es.report.pages.guard);
    expect(JSON.stringify(report.state)).toContain(es.report.guard.flow.title);
  });

  it('never saves an unedited built-in report, so the next visit shows it in that visit’s language', () => {
    memoryStorage();
    saveReports(initialReports(english));
    const { reports } = loadReports(spanish);
    expect(reports[0].name).toBe(es.report.name);
    expect(reports[0].pageTitles.activity).toBe(es.report.pages.activity);
  });

  it('keeps an edited built-in report in the language it was saved in', () => {
    memoryStorage();
    const built = defaultReport(english);
    const edited = { ...built, pageTitles: { ...built.pageTitles, guard: 'My guard page' } };
    saveReports({ reports: [edited], activeId: BUILT_IN_ID });
    const [report] = loadReports(spanish).reports;
    expect(report.pageTitles.guard).toBe('My guard page');
    expect(report.pageTitles.activity).toBe('Agent activity');
  });
});
