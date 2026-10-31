// The built-in "PayPal overview" report, as AG Studio report state: the shop's AI agents and the
// payment guard first ("AI operations" and "Agent activity"), then the PayPal pages for revenue
// and cash, receivables and catalogue. Field ids ('invoices.paidAmount') refer to the data sources
// in ./data.ts.
//
// Studio colours series by position (./theme.ts): the guard charts plot allowed, held and blocked
// as three measures in that order, so they are always the traffic light's green, amber and red.

import type { AgPageState, AgReportState, AgWidgetLayoutState } from 'ag-studio';

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
const chartStyle = (barWidth?: number, { legend = true }: { legend?: boolean } = {}) => ({
  theme: {
    common: { legend: { enabled: legend, position: 'top-left' as const } },
    ...(barWidth && { bar: { series: { width: barWidth } } }),
  },
  custom: AXES,
});

// The guard's three verdicts as measures, in palette order: allowed green, held amber, blocked red.
// Named measures from ./data.ts, so the legend reads 'Allowed', not 'Allowed (sum)'.
const VERDICTS = [{ id: 'allowedCalls' }, { id: 'heldCalls' }, { id: 'blockedCalls' }];

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
// What the shop's AI agents (support and billing) did through the payment guard. The sentence,
// verdict strip and money above the canvas (../components/control-room-header.tsx) already say how
// many calls went through, were held or were stopped, so the canvas doesn't repeat them as KPIs: it
// has the agent switch, the personal data the guard withheld, how it decided over time, why it
// stopped calls, its latest decisions, what the agents did, the money they handled and what waits
// for the owner (lib/guard/dashboard-rows.ts).

const guard: AgPageState = {
  id: 'guard',
  widgets: {
    agent: {
      type: 'button-filter',
      dataMapping: { value: [{ id: 'guardDecisions.agent' }] },
      format: {
        // No title: the two buttons fill the tile. None picked shows both agents.
        title: { enabled: false },
        style: { selection: { type: 'multiple' }, dimensions: { height: 36, minWidth: 96 } },
      },
    },
    'kpi-withheld': kpi('Personal data withheld', sum('guardDecisions.withheld'), 'Customer details the guard kept from the agents when they read PayPal'),
    timeline: {
      // One axis only: the share stopped, on a second scale, would read as another count.
      type: 'column-chart-stacked',
      dataMapping: {
        // The decision's own date, not the shared calendar: calendar days without a decision would
        // show up as empty columns.
        categoryKey: [{ id: 'guardDecisions.day' }],
        valueKey: VERDICTS,
      },
      format: {
        ...titled('Decisions per day', 'Calls that went through, were held or were stopped'),
        style: chartStyle(),
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
        ...titled('What the agents tried to do', 'Calls by action, most stopped first'),
        style: chartStyle(BAR),
      },
    },
    money: {
      type: 'column-chart-grouped',
      dataMapping: {
        categoryKey: [{ id: 'guardDecisions.day' }],
        // Palette order: moved green, billed amber (billed, not yet paid), protected red.
        valueKey: [{ id: 'moneyMoved' }, { id: 'moneyBilled' }, { id: 'moneyProtected' }],
      },
      format: {
        ...titled('Money handled per day', 'Paid back to customers, invoiced, and kept in the shop by the guard (USD)'),
        style: chartStyle(),
      },
    },
    reasons: {
      type: 'bar-chart-stacked',
      dataMapping: {
        // Violations join their decision, so each rule shows how often it led to a block (red) or a
        // hold for a person (amber).
        categoryKey: [{ id: 'guardViolations.reason' }],
        valueKey: VERDICTS,
      },
      sort: [{ field: { id: 'blockedCalls' }, direction: 'desc' }],
      format: {
        ...titled('Why the guard stopped a call', 'Rules the agents broke, most stops first'),
        style: chartStyle(BAR),
      },
    },
    held: {
      type: 'grid',
      dataMapping: {
        // The entry id keeps one row per held action, which a person decides on /guard.
        cols: [
          { id: 'guardDecisions.at' },
          { id: 'guardDecisions.id' },
          { id: 'guardDecisions.agent' },
          { id: 'guardDecisions.action' },
          { id: 'guardDecisions.tool' },
          { id: 'guardDecisions.customer' },
          // No measure column: the grid drops rows whose measures are all blank, and only refunds
          // state a requested amount, so held invoices would vanish from the list.
        ],
      },
      sort: [{ field: { id: 'guardDecisions.at' }, direction: 'asc' }],
      format: { ...titled('Held actions waiting for you', 'Oldest first. Approve or reject them in the guard log.'), crossFilter: 'filter' },
    },
    feed: {
      type: 'grid',
      dataMapping: {
        // Dimensions only: the grid drops rows whose measures are all blank, and reads carry no
        // money, so a measure column would hide them. The time keeps one row per decision.
        cols: [
          { id: 'guardDecisions.at' },
          { id: 'guardDecisions.agent' },
          { id: 'guardDecisions.action' },
          { id: 'guardDecisions.decision' },
          { id: 'guardDecisions.customer' },
        ],
      },
      sort: [{ field: { id: 'guardDecisions.at' }, direction: 'desc' }],
      format: {
        ...titled('Latest decisions', 'Newest first. Click one to filter the page.'),
        // Columns as wide as their text; a narrow tile scrolls sideways instead of cutting words.
        style: { columnAutoSize: true },
        crossFilter: 'filter',
      },
    },
  },
  widgetLayout: {
    agent: at(0, 0, 12, 7),
    'kpi-withheld': at(12, 0, 12, 7),
    // Full width and tall: the cover's main chart.
    timeline: at(0, 7, 24, 24),
    reasons: at(0, 31, 12, 24),
    feed: at(12, 31, 12, 24),
    'by-action': at(0, 55, 12, 23),
    money: at(12, 55, 12, 23),
    held: at(0, 78, 24, 16),
  },
  filter: {
    // The agent switch on the canvas; no agent picked shows both.
    page: [{ field: { id: 'guardDecisions.agent' }, filterWidgetId: 'agent' }],
    // Only held actions no person has decided yet.
    widget: {
      held: [{ field: { id: 'guardDecisions.awaitingApproval' }, model: { operator: 'equals', value: 1 } }],
    },
  },
};

// --- Agent activity: the guard's full log, sliced -----------------------------------

const activity: AgPageState = {
  id: 'activity',
  widgets: {
    pivot: {
      type: 'pivot-grid',
      dataMapping: {
        // Expand an agent to see its actions.
        rows: [{ id: 'guardDecisions.agent' }, { id: 'guardDecisions.action' }],
        columns: [],
        values: VERDICTS,
      },
      format: {
        ...titled('Calls by agent and action', 'Expand an agent to see what it did'),
        style: { grandTotalRow: { enabled: true } },
      },
    },
    customers: {
      type: 'bar-chart-stacked',
      dataMapping: {
        categoryKey: [{ id: 'guardDecisions.customer' }],
        valueKey: VERDICTS,
      },
      sort: [{ field: { id: 'blockedCalls' }, direction: 'desc' }],
      format: {
        ...titled('Customers on whose behalf the agents acted', 'Most blocked first: a customer attacked or attacking the agents'),
        style: chartStyle(BAR),
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
      format: { ...titled('Every decision, newest first', 'Click a row to filter the charts above'), crossFilter: 'filter' },
    },
  },
  widgetLayout: {
    pivot: at(0, 0, 13, 24),
    customers: at(13, 0, 11, 24),
    decisions: at(0, 24, 24, 28),
  },
};

// --- Revenue & cash -----------------------------------------------------------------

const revenue: AgPageState = {
  id: 'revenue',
  widgets: {
    'kpi-sales': kpi('Sales (31 days)', sum('transactions.sales'), 'Payments customers made to the shop', { sparklineX: 'calendar::day' }),
    'kpi-net': kpi('Net cash flow (31 days)', sum('transactions.net'), 'Everything in and out of the account, after fees'),
    'kpi-balance': kpi('Available balance', sum('balances.available'), 'In the PayPal account now'),
    'kpi-invoiced': kpi('Invoiced', sum('invoices.issuedAmount'), 'Sent invoices, all currencies'),
    // One table per chart: summing two tables over the shared calendar in one chart multiplies
    // their rows, so sales and the agents' money live in separate charts (the agents' on the cover).
    sales: {
      type: 'column-chart-grouped',
      dataMapping: {
        categoryKey: [{ id: 'calendar::day' }],
        valueKey: [{ id: 'salesTotal' }],
      },
      format: { ...titled('Sales per day', 'Payments customers made to the shop, last 31 days'), style: chartStyle(undefined, { legend: false }) },
    },
    'in-out': {
      type: 'column-chart-grouped',
      dataMapping: {
        categoryKey: [{ id: 'calendar::day' }],
        // Measures, not a split by direction: days without a transaction would add a blank series.
        valueKey: [{ id: 'moneyInTotal' }, { id: 'moneyOutTotal' }],
      },
      format: { ...titled('Money in and out per day', 'Credits and debits on the PayPal ledger'), style: chartStyle() },
    },
    'event-types': {
      type: 'bar-chart-grouped',
      dataMapping: {
        categoryKey: [{ id: 'transactions.eventType' }],
        valueKey: [countd('transactions.id')],
      },
      sort: [{ field: countd('transactions.id'), direction: 'desc' }],
      format: { ...titled('Ledger activity by type', 'Number of PayPal transactions, most frequent first'), style: chartStyle(BAR, { legend: false }) },
    },
    'status-sunburst': {
      type: 'sunburst-chart',
      dataMapping: {
        categoryKey: [{ id: 'invoices.statusGroup' }, { id: 'customers.name' }],
        valueKey: [sum('invoices.total')],
      },
      format: titled('Invoice value by status and customer', 'Click a status to drill into its customers'),
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
      format: { ...titled('PayPal ledger, newest first', 'Last 31 days of account activity'), style: { headerRow: { wrapText: true } }, crossFilter: 'filter' },
    },
  },
  widgetLayout: {
    'kpi-sales': at(0, 0, 6, 9),
    'kpi-net': at(6, 0, 6, 9),
    'kpi-balance': at(12, 0, 6, 9),
    'kpi-invoiced': at(18, 0, 6, 9),
    sales: at(0, 9, 12, 23),
    'in-out': at(12, 9, 12, 23),
    'event-types': at(0, 32, 14, 23),
    'status-sunburst': at(14, 32, 10, 23),
    ledger: at(0, 55, 24, 24),
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
        ...titled('Currency'),
        style: { selection: { type: 'single' }, dimensions: { height: 32, minWidth: 56 } },
      },
    },
    'kpi-outstanding': kpi('Outstanding', sum('invoices.outstanding'), 'Open and partially paid invoices'),
    'kpi-overdue': kpi('Overdue', sum('invoices.overdueAmount'), 'Past their due date'),
    'kpi-open': kpi('Open invoices', countd('invoices.id'), 'Waiting for payment'),
    'by-invoice-date': {
      type: 'column-chart-grouped',
      dataMapping: {
        categoryKey: [{ id: 'invoices.invoiceDate' }],
        valueKey: [{ id: 'outstandingTotal' }, { id: 'overdueTotal' }],
      },
      format: { ...titled('Outstanding by invoice date', 'Still owed, and how much of it is past due'), style: chartStyle(COLUMN) },
    },
    aging: {
      type: 'column-chart-stacked',
      dataMapping: {
        categoryKey: [{ id: 'customers.name' }],
        valueKey: [sum('invoices.total')],
        legendKey: [{ id: 'invoices.status' }],
      },
      sort: [{ field: sum('invoices.total'), direction: 'desc' }],
      format: { ...titled('Receivables by customer and status', 'Largest balance first'), style: chartStyle(COLUMN) },
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
      format: { ...titled('Open invoices, most overdue first'), crossFilter: 'filter' },
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
    'kpi-products': kpi('Products', countd('products.id'), 'Sold as subscriptions'),
    'kpi-plans': kpi('Billing plans', countd('plans.id'), 'Across all products'),
    'kpi-monthly': kpi('Avg monthly price', avg('plans.monthlyPrice'), 'Normalised to one month, USD'),
    'kpi-trial': kpi('Avg trial days', avg('plans.trialDays'), 'Before the first charge'),
    'plan-intervals': {
      type: 'donut-chart',
      dataMapping: {
        categoryKey: [{ id: 'plans.billingInterval' }],
        valueKey: [countd('plans.id')],
      },
      format: {
        ...titled('Plans by billing interval'),
        style: {
          theme: { common: { legend: { enabled: true, position: 'right' as const } } },
          custom: { pieDataLabel: { enabled: true, position: 'outside' as const, format: 'percent' as const, outsideColor: MUTED, fontSize: 12 }, totalLabel: { enabled: true } },
        },
      },
    },
    'price-range': {
      type: 'bar-chart-grouped',
      dataMapping: {
        categoryKey: [{ id: 'products.name' }],
        valueKey: [avg('plans.monthlyPrice')],
      },
      sort: [{ field: avg('plans.monthlyPrice'), direction: 'desc' }],
      format: { ...titled('Monthly price by product', 'Average across its plans, USD'), style: chartStyle(BAR, { legend: false }) },
    },
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
      format: { ...titled('Plan catalogue'), crossFilter: 'filter' },
    },
    'catalogue-sunburst': {
      type: 'sunburst-chart',
      dataMapping: {
        categoryKey: [{ id: 'products.type' }, { id: 'products.name' }, { id: 'plans.name' }],
        valueKey: [sum('plans.monthlyPrice')],
      },
      format: titled('Type, product and plan', 'Sized by monthly price; click to drill in'),
    },
  },
  widgetLayout: {
    'kpi-products': at(0, 0, 6, 9),
    'kpi-plans': at(6, 0, 6, 9),
    'kpi-monthly': at(12, 0, 6, 9),
    'kpi-trial': at(18, 0, 6, 9),
    'plan-intervals': at(0, 9, 7, 23),
    'catalogue-sunburst': at(7, 9, 8, 23),
    'price-range': at(15, 9, 9, 23),
    plans: at(0, 32, 24, 14),
  },
};

// The report opens on the AI agents and their guard; the PayPal pages follow.
export const dashboardReport: AgReportState = {
  selectedPageId: guard.id,
  pages: [guard, activity, revenue, receivables, catalogue],
};
