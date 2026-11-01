// Page titles for the sidebar and header. Studio's state has no page names, so each report
// keeps its own map of page id -> title. Pages without a saved title are numbered by position,
// as `numbered` words it ("Page 2"; `reports.pageNumber` in the dashboard's messages).

import type { AgReportState } from 'ag-studio';

type Titled = { pageTitles: Record<string, string>; state: AgReportState };

export type ReportPage = { id: string; title: string };

export type PageNumber = (position: number) => string;

const english: PageNumber = (position) => `Page ${position}`;

export const pageTitle = (report: Titled, pageId: string, numbered: PageNumber = english) =>
  report.pageTitles[pageId] ?? numbered(report.state.pages.findIndex((page) => page.id === pageId) + 1);

export const pagesFor = (report: Titled, numbered: PageNumber = english): ReportPage[] =>
  report.state.pages.map((page) => ({ id: page.id, title: pageTitle(report, page.id, numbered) }));

export const pageTitlesFor = (report: Titled, numbered: PageNumber = english): Record<string, string> =>
  Object.fromEntries(pagesFor(report, numbered).map((page) => [page.id, page.title]));
