// The built-in "PayPal overview" report, as AG Studio report state, with its text in the app's
// language (`report.*` in messages/<locale>/dashboard.json): the shop's AI agents and the
// payment guard first ("AI operations" and "Agent activity"), then the PayPal pages for revenue
// and cash, receivables and catalogue. Field ids ('invoices.paidAmount') refer to the data sources
// in ./data.ts.
//
// Studio colours series by position (./theme.ts): the guard charts plot passed, held and stopped
// as three measures in that order, so they are always the traffic light's green, amber and red.

import type { AgPageState, AgReportState, AgWidgetLayoutState } from 'ag-studio';
import type { Translate } from '../translate';
import { GUARD_FLOW } from './widgets';

// --- Helpers ----------------------------------------------------------------------

// Position on the canvas grid, in tracks: 24 columns wide, rows of studioCanvasRowHeight.
const at = (xTrack: number, yTrack: number, xSpan: number, ySpan: number): AgWidgetLayoutState => ({
  xTrack,
  yTrack,
  xSpan,
  ySpan,
});
const sum = (id: string) => ({ id, aggregation: 'sum' as const });
const avg = (id: string) => ({ id, aggregation: 'avg' as const });
const countd = (id: string) => ({ id, aggregation: 'countd' as const });

// Same stack as --pp-font in app/globals.css: the app's typeface (next/font's --font-ui), then
// the system fallbacks.
const PAYPAL_FONT = 'var(--font-ui), "Helvetica Neue", Helvetica, Arial, sans-serif';

const typography = (fontSize: number, fontWeight: 'normal' | 'bold' = 'normal') => ({
  fontFamily: PAYPAL_FONT,
  fontSize,
  fontWeight,
  fontStyle: 'normal' as const,
});

// A widget title with a muted line under it saying what to read from it.
const titled = (text: string, subtitle?: string) => ({
  title: { enabled: true, text, wrapping: true },
  ...(subtitle && { subtitle: { enabled: true, text: subtitle, wrapping: true } }),
});

// Chart chrome, the same on every chart, so they read as one set rather than spreadsheet defaults:
// the legend above the plot at the left, where reading starts; thin bars of a fixed width; faint
// gridlines on the value axis only; no ticks; small muted axis labels; a hairline baseline.
const MUTED = '#56627a';
const GRIDLINE = '#eaeef3';
const BASELINE = '#dce3ec';
const axisLabel = { fontSize: 12, color: MUTED };
const AXES = {
  categoryAxis: { line: { stroke: BASELINE, width: 1 }, tick: { enabled: false }, gridLine: { enabled: false }, label: axisLabel },
  valueAxis: { line: { stroke: BASELINE, width: 0 }, tick: { enabled: false }, gridLine: { enabled: true, style: { stroke: GRIDLINE, strokeWidth: 1 } }, label: axisLabel },
};
// Bars of a fixed thickness (px) where the categories are few, like actions, rules, customers or a
// handful of invoice dates: left automatic, Studio stretches a lone bar across the whole chart.
// Charts over a month of days keep the automatic width: a fixed one would not fit and would scroll.
const BAR = 16;
const COLUMN = 28;
// `everyDay`: a date axis drawn as one category per day, so every bar has its date under it; a
// time axis labels only some days and leaves bars unnamed. For charts over a few days only.
const chartStyle = (barWidth?: number, { legend = true, everyDay = false }: { legend?: boolean; everyDay?: boolean } = {}) => ({
  theme: {
    common: { legend: { enabled: legend, position: 'top-left' as const } },
    ...(barWidth && { bar: { series: { width: barWidth } } }),
  },
  custom: { ...AXES, ...(everyDay && { categoryAxisMode: 'categorical' as const }) },
});

// The guard's three verdicts as measures, in palette order: passed green, held amber, stopped red.
// Named measures from ./data.ts, so the legend reads 'Passed', not 'Passed (sum)'.
const VERDICTS = [{ id: 'allowedCalls' }, { id: 'heldCalls' }, { id: 'blockedCalls' }];

// A widget filter for charts that answer "what was stopped": with only stopped calls left, the passed
// and held measures are zero, so the bars keep the verdict palette's red (Studio colours by position,
// and a lone 'Stopped' measure would take the first colour, green).
const STOPPED_ONLY = { field: { id: 'guardDecisions.blocked' }, model: { operator: 'equals' as const, value: 1 } };

type Measure = { id: string; aggregation?: 'sum' | 'avg' | 'countd' };

// A KPI tile, styled the same everywhere: a full (wrapping) title, a large value, a caption saying
// what the number means and an optional sparkline along `sparklineX`. KPIs follow the clicks on
// the page's charts (cross-filter), so they always describe the current selection.
const kpi = (
  text: string,
  value: Measure,
  caption: string,
  { size = 30, sparklineX, color = 'var(--pp-navy)' }: { size?: number; sparklineX?: string; color?: string } = {},
) => ({
  type: 'value' as const,
  dataMapping: {
    value: [value],
    ...(sparklineX && { sparklineX: [{ id: sparklineX }] }),
  },
  format: {
    title: { enabled: true, text, wrapping: true, typography: typography(14, 'bold') },
    caption: { enabled: true, text: caption, wrapping: true, typography: typography(12) },
    style: {
      typography: typography(size, 'bold'),
      color,
      verticalAlign: 'top' as const,
      ...(sparklineX && { sparkline: { type: 'bar' as const } }),
    },
    crossFilter: 'filter' as const,
  },
});

// --- AI operations: the cover ------------------------------------------------------
// What the shop's AI agents did through the payment guard, each fact shown once: the flow from
// every agent through the guard to its verdicts (click an agent to filter the page), the money it
// kept in or let out, what waits for a person, the personal data it withheld, how it decided day by
// day, what the agents tried and why calls were stopped (lib/guard/dashboard-rows.ts). The full list
// of decisions is on Agent activity, and held calls are decided in the guard log.

// The whole report, its titles in the language of `t`.
export function dashboardReport(t: Translate): AgReportState {
  // The cover's own widget (./guard-flow.tsx): every call from its agent to what the guard did. The
  // report's types only know Studio's widget types, so ours goes in as one of them (./widgets.ts).
  const guardFlow = {
    type: GUARD_FLOW,
    dataMapping: { categoryKey: [{ id: 'guardDecisions.agent' }], valueKey: VERDICTS },
    format: {
      ...titled(t('report.guard.flow.title'), t('report.guard.flow.subtitle')),
      crossFilter: 'filter' as const,
    },
  } as unknown as NonNullable<AgPageState['widgets']>[string];

  const guard: AgPageState = {
    id: 'guard',
    widgets: {
      flow: guardFlow,
      // The figures the page's charts don't show: money the guard kept in or let out, what waits for a
      // person, and the personal data it kept from the agents.
      'kpi-protected': kpi(t('report.guard.kpiProtected.title'), { id: 'moneyProtected' }, t('report.guard.kpiProtected.caption')),
      'kpi-moved': kpi(t('report.guard.kpiMoved.title'), { id: 'moneyMoved' }, t('report.guard.kpiMoved.caption')),
      'kpi-waiting': kpi(t('report.guard.kpiWaiting.title'), sum('guardDecisions.awaitingApproval'), t('report.guard.kpiWaiting.caption')),
      'kpi-withheld': kpi(t('report.guard.kpiWithheld.title'), sum('guardDecisions.withheld'), t('report.guard.kpiWithheld.caption')),
      timeline: {
        // One axis only: the share stopped, on a second scale, would read as another count.
        type: 'column-chart-stacked',
        dataMapping: {
          // The decision's own date, not the shared calendar: calendar days without a decision would
          // show up as empty columns.
          categoryKey: [{ id: 'guardDecisions.dayText' }],
          valueKey: VERDICTS,
        },
        sort: [{ field: { id: 'guardDecisions.dayText' }, direction: 'asc' }],
        format: {
          ...titled(t('report.guard.timeline.title'), t('report.guard.timeline.subtitle')),
          // Thin bars, one per day with space between, so neighbouring days never read as one bar.
          style: chartStyle(COLUMN, { everyDay: true }),
        },
      },
      'by-action': {
        type: 'bar-chart-stacked',
        dataMapping: {
          categoryKey: [{ id: 'guardDecisions.action' }],
          valueKey: VERDICTS,
        },
        sort: [{ field: { id: 'blockedCalls' }, direction: 'desc' }],
        format: {
          ...titled(t('report.guard.byAction.title'), t('report.guard.byAction.subtitle')),
          style: chartStyle(BAR),
        },
      },
      reasons: {
        type: 'bar-chart-stacked',
        dataMapping: {
          // Violations join their decision. The widget filter below keeps stopped calls only, so the
          // passed and held measures are zero and the bars are all stopped red.
          categoryKey: [{ id: 'guardViolations.reason' }],
          valueKey: VERDICTS,
        },
        sort: [{ field: { id: 'blockedCalls' }, direction: 'desc' }],
        format: {
          ...titled(t('report.guard.reasons.title'), t('report.guard.reasons.subtitle')),
          style: chartStyle(BAR, { legend: false }),
        },
      },
    },
    widgetLayout: {
      // Full width: the cover's own widget, then its figures, then how it went over time and why.
      flow: at(0, 0, 24, 20),
      'kpi-protected': at(0, 20, 6, 8),
      'kpi-moved': at(6, 20, 6, 8),
      'kpi-waiting': at(12, 20, 6, 8),
      'kpi-withheld': at(18, 20, 6, 8),
      timeline: at(0, 28, 24, 22),
      'by-action': at(0, 50, 12, 23),
      reasons: at(12, 50, 12, 23),
    },
    filter: {
      widget: { reasons: [STOPPED_ONLY] },
    },
  };

  // --- Agent activity: the guard's full log, sliced -----------------------------------

  const activity: AgPageState = {
    id: 'activity',
    widgets: {
      customers: {
        type: 'bar-chart-stacked',
        dataMapping: {
          categoryKey: [{ id: 'guardDecisions.customer' }],
          valueKey: VERDICTS,
        },
        sort: [{ field: { id: 'blockedCalls' }, direction: 'desc' }],
        format: {
          // Stopped calls only (widget filter below): who attacked, or whose name an attack used.
          ...titled(t('report.activity.customers.title'), t('report.activity.customers.subtitle')),
          style: chartStyle(BAR, { legend: false }),
          seriesLimit: { enabled: false },
        },
      },
      decisions: {
        type: 'grid',
        dataMapping: {
          cols: [
            { id: 'guardDecisions.at' },
            { id: 'guardDecisions.agent' },
            { id: 'guardDecisions.action' },
            { id: 'guardDecisions.verdict' },
            { id: 'guardDecisions.decidedBy' },
            { id: 'guardDecisions.customer' },
            { id: 'moneyMoved' },
            { id: 'moneyProtected' },
            { id: 'moneyBilled' },
          ],
        },
        sort: [{ field: { id: 'guardDecisions.at' }, direction: 'desc' }],
        format: { ...titled(t('report.activity.decisions.title'), t('report.activity.decisions.subtitle')), crossFilter: 'filter' },
      },
    },
    widgetLayout: {
      customers: at(0, 0, 24, 22),
      decisions: at(0, 22, 24, 28),
    },
    filter: {
      widget: { customers: [STOPPED_ONLY] },
    },
  };

  // --- Revenue & cash -----------------------------------------------------------------

  const revenue: AgPageState = {
    id: 'revenue',
    widgets: {
      'kpi-sales': kpi(t('report.revenue.kpiSales.title'), sum('transactions.sales'), t('report.revenue.kpiSales.caption'), { sparklineX: 'calendar::day' }),
      'kpi-balance': kpi(t('report.revenue.kpiBalance.title'), sum('balances.available'), t('report.revenue.kpiBalance.caption')),
      'kpi-invoiced': kpi(t('report.revenue.kpiInvoiced.title'), sum('invoices.issuedAmount'), t('report.revenue.kpiInvoiced.caption')),
      // One table per chart: summing two tables over the shared calendar in one chart multiplies
      // their rows, so sales and the agents' money live in separate charts (the agents' on the cover).
      'in-out': {
        type: 'column-chart-grouped',
        dataMapping: {
          categoryKey: [{ id: 'calendar::day' }],
          // Measures, not a split by direction: days without a transaction would add a blank series.
          valueKey: [{ id: 'moneyInTotal' }, { id: 'moneyOutTotal' }],
        },
        format: { ...titled(t('report.revenue.inOut.title'), t('report.revenue.inOut.subtitle')), style: chartStyle() },
      },
      'event-types': {
        type: 'bar-chart-grouped',
        dataMapping: {
          categoryKey: [{ id: 'transactions.eventType' }],
          valueKey: [countd('transactions.id')],
        },
        sort: [{ field: countd('transactions.id'), direction: 'desc' }],
        format: { ...titled(t('report.revenue.eventTypes.title'), t('report.revenue.eventTypes.subtitle')), style: chartStyle(BAR, { legend: false }) },
      },
      ledger: {
        type: 'grid',
        dataMapping: {
          cols: [
            { id: 'transactions.date' },
            { id: 'transactions.eventType' },
            { id: 'transactions.counterparty' },
            sum('transactions.amount'),
            sum('transactions.net'),
          ],
        },
        sort: [{ field: { id: 'transactions.date' }, direction: 'desc' }],
        // Long field names ('Transaction Amount (sum)') wrap instead of being cut off.
        format: { ...titled(t('report.revenue.ledger.title'), t('report.revenue.ledger.subtitle')), style: { headerRow: { wrapText: true } }, crossFilter: 'filter' },
      },
    },
    widgetLayout: {
      'kpi-sales': at(0, 0, 8, 9),
      'kpi-balance': at(8, 0, 8, 9),
      'kpi-invoiced': at(16, 0, 8, 9),
      'in-out': at(0, 9, 14, 23),
      'event-types': at(14, 9, 10, 23),
      ledger: at(0, 32, 24, 24),
    },
  };

  // --- Receivables --------------------------------------------------------------------

  const receivables: AgPageState = {
    id: 'receivables',
    widgets: {
      // Invoice money isn't converted between currencies, so this page is driven by a
      // single-select currency switch, starting on USD (see the page filter below).
      currency: {
        type: 'button-filter',
        dataMapping: { value: [{ id: 'invoices.currency' }] },
        format: {
          ...titled(t('report.receivables.currency.title')),
          style: { selection: { type: 'single' }, dimensions: { height: 32, minWidth: 56 } },
        },
      },
      'kpi-outstanding': kpi(t('report.receivables.kpiOutstanding.title'), sum('invoices.outstanding'), t('report.receivables.kpiOutstanding.caption')),
      'kpi-overdue': kpi(t('report.receivables.kpiOverdue.title'), sum('invoices.overdueAmount'), t('report.receivables.kpiOverdue.caption')),
      'kpi-open': kpi(t('report.receivables.kpiOpen.title'), countd('invoices.id'), t('report.receivables.kpiOpen.caption')),
      'by-invoice-date': {
        type: 'column-chart-grouped',
        dataMapping: {
          categoryKey: [{ id: 'invoices.invoiceDate' }],
          valueKey: [{ id: 'outstandingTotal' }, { id: 'overdueTotal' }],
        },
        format: { ...titled(t('report.receivables.byInvoiceDate.title'), t('report.receivables.byInvoiceDate.subtitle')), style: chartStyle(COLUMN, { everyDay: true }) },
      },
      aging: {
        type: 'column-chart-stacked',
        dataMapping: {
          categoryKey: [{ id: 'customers.name' }],
          valueKey: [sum('invoices.total')],
          legendKey: [{ id: 'invoices.status' }],
        },
        sort: [{ field: sum('invoices.total'), direction: 'desc' }],
        format: { ...titled(t('report.receivables.aging.title'), t('report.receivables.aging.subtitle')), style: chartStyle(COLUMN) },
      },
      'open-invoices': {
        type: 'grid',
        dataMapping: {
          cols: [
            { id: 'invoices.number' },
            { id: 'customers.name' },
            { id: 'invoices.statusGroup' },
            { id: 'invoices.dueDate' },
            { id: 'invoices.daysOverdue' },
            sum('invoices.total'),
            sum('invoices.outstanding'),
          ],
        },
        sort: [{ field: { id: 'invoices.daysOverdue' }, direction: 'desc' }],
        format: { ...titled(t('report.receivables.openInvoices.title')), crossFilter: 'filter' },
      },
    },
    widgetLayout: {
      'kpi-outstanding': at(0, 0, 6, 9),
      'kpi-overdue': at(6, 0, 6, 9),
      'kpi-open': at(12, 0, 6, 9),
      currency: at(18, 0, 6, 9),
      aging: at(0, 9, 10, 23),
      'by-invoice-date': at(10, 9, 14, 23),
      'open-invoices': at(0, 32, 24, 22),
    },
    filter: {
      page: [
        {
          field: { id: 'invoices.currency' },
          model: { operator: 'isIn', value: ['USD'] },
          filterWidgetId: 'currency',
        },
        { field: { id: 'invoices.isReceivable' }, model: { operator: 'isTrue' } },
      ],
    },
  };

  // --- Catalogue ----------------------------------------------------------------------

  const catalogue: AgPageState = {
    id: 'catalogue',
    widgets: {
      'kpi-products': kpi(t('report.catalogue.kpiProducts.title'), countd('products.id'), t('report.catalogue.kpiProducts.caption')),
      'kpi-plans': kpi(t('report.catalogue.kpiPlans.title'), countd('plans.id'), t('report.catalogue.kpiPlans.caption')),
      'kpi-monthly': kpi(t('report.catalogue.kpiMonthly.title'), avg('plans.monthlyPrice'), t('report.catalogue.kpiMonthly.caption')),
      'kpi-trial': kpi(t('report.catalogue.kpiTrial.title'), avg('plans.trialDays'), t('report.catalogue.kpiTrial.caption')),
      plans: {
        type: 'grid',
        dataMapping: {
          cols: [
            { id: 'products.name' },
            { id: 'plans.name' },
            { id: 'plans.status' },
            { id: 'plans.billingInterval' },
            sum('plans.price'),
            sum('plans.monthlyPrice'),
          ],
        },
        sort: [{ field: sum('plans.monthlyPrice'), direction: 'desc' }],
        format: { ...titled(t('report.catalogue.plans.title')), crossFilter: 'filter' },
      },
    },
    widgetLayout: {
      'kpi-products': at(0, 0, 6, 9),
      'kpi-plans': at(6, 0, 6, 9),
      'kpi-monthly': at(12, 0, 6, 9),
      'kpi-trial': at(18, 0, 6, 9),
      plans: at(0, 9, 24, 14),
    },
  };

  // The report opens on the AI agents and their guard; the PayPal pages follow.
  return {
    selectedPageId: guard.id,
    pages: [guard, activity, revenue, receivables, catalogue],
  };
}
