import { afterEach, describe, expect, it, vi } from 'vitest';
import { BUILT_IN_ID, defaultReport, loadReports, type SavedReport } from './reports-store';

const storeWith = (reports: SavedReport[]) => {
  const raw = JSON.stringify({ reports, activeId: BUILT_IN_ID });
  vi.stubGlobal('localStorage', { getItem: () => raw, setItem: () => {} });
};

afterEach(() => vi.unstubAllGlobals());

describe('loadReports', () => {
  it('opens the built-in report on the payment guard page', () => {
    expect(defaultReport().state.selectedPageId).toBe('guard');
    expect(defaultReport().state.pages[0].id).toBe('guard');
  });

  it('lists the AI agents first, then the PayPal pages, each with a title', () => {
    // The empty "Cash & payouts" page went: the sandbox has no payouts, and the balance now sits on "Revenue & cash".
    const report = defaultReport();
    expect(report.state.pages.map((p) => report.pageTitles[p.id])).toEqual([
      'AI operations',
      'Agent activity',
      'Revenue & cash',
      'Receivables',
      'Catalogue',
    ]);
  });

  it('keeps a saved copy of the current built-in report', () => {
    const edited = { ...defaultReport(), name: 'My overview' };
    storeWith([edited]);
    expect(loadReports().reports[0].name).toBe('My overview');
  });

  it('replaces a built-in report saved before its pages changed, and keeps the reports people made', () => {
    const previous: SavedReport = { ...defaultReport(), name: 'Saved under version 2', version: 2 };
    storeWith([previous]);
    expect(loadReports().reports[0].name).toBe(defaultReport().name);
  });

  it('replaces a built-in report saved before reports carried a version', () => {
    // Saved before reports carried a version.
    const stale: SavedReport = { ...defaultReport(), name: 'Old overview', version: undefined };
    const mine: SavedReport = { ...defaultReport(), id: 'report-1', builtIn: undefined, name: 'Mine' };
    storeWith([stale, mine]);
    const { reports } = loadReports();
    expect(reports.map((r) => r.name)).toEqual([defaultReport().name, 'Mine']);
  });
});
