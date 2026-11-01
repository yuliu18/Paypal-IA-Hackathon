// Saved reports as React state, written through to localStorage on every change.

import { useRef, useState } from 'react';
import { findReport, loadReports, saveReports, upsert, type SavedReport, type StoredReports } from './reports-store';
import type { Translate } from './translate';

// `t` builds the built-in report in the app's language when no edited copy of it is saved.
export function useReports(t: Translate) {
  const [store, setStore] = useState(() => loadReports(t));
  // The latest reports, for handlers that run one after another before React re-renders.
  const storeRef = useRef(store);

  const update = (change: (current: StoredReports) => StoredReports) => {
    const next = change(storeRef.current);
    storeRef.current = next;
    saveReports(next);
    setStore(next);
  };

  const editReport = (id: string, change: (report: SavedReport) => SavedReport) =>
    update((current) => {
      const report = findReport(current.reports, id);
      return report ? upsert(current, change(report)) : current;
    });

  return { store, latest: () => storeRef.current, update, editReport };
}
