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

  it('keeps a saved copy of the current built-in report', () => {
    const edited = { ...defaultReport(), name: 'My overview' };
    storeWith([edited]);
    expect(loadReports().reports[0].name).toBe('My overview');
  });

  it('replaces a built-in report saved before its pages changed, and keeps the reports people made', () => {
    // Saved before reports carried a version.
    const stale: SavedReport = { ...defaultReport(), name: 'Old overview', version: undefined };
    const mine: SavedReport = { ...defaultReport(), id: 'report-1', builtIn: undefined, name: 'Mine' };
    storeWith([stale, mine]);
    const { reports } = loadReports();
    expect(reports.map((r) => r.name)).toEqual([defaultReport().name, 'Mine']);
  });
});
