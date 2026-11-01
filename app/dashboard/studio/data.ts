// AG Studio's data sources for the dashboard: a table for each row type in lib/dashboard-data.ts and
// lib/guard/dashboard-rows.ts, the relationships between them, a shared calendar and a few
// calculated measures.

import type {
  AgDataSourcesDefinition,
  AgExpressionFieldDefinition,
  AgFieldDefinition,
  AgFormat,
  AgRelationDefinition,
} from 'ag-studio';
import type { DashboardData } from '@/lib/dashboard-data';
import type { Translate } from '../translate';

// --- Helpers ----------------------------------------------------------------------

const CALENDAR_ID = 'calendar';

// 'usd' is currencyFormat shown with a dollar sign: the guard's money is always USD, since the
// shop's PayPal sandbox account and every amount the guard records are in USD.
type FieldFormat = AgFormat | 'usd';

// [id, format, hide?]; the field's name is the message `data.fields.<table>.<id>`.
type FieldSpec = [id: string, format: FieldFormat, hide?: boolean];

// Numbers in English like the rest of the app, whatever the browser's language: a format pattern
// ('#,##0') would group digits the browser's way, so a Spanish browser would read 5,148 as 5.148.
const EN = 'en-US';
const USD = { format: new Intl.NumberFormat(EN, { style: 'currency', currency: 'USD' }) };
const NUMBER_OPTIONS: Partial<Record<FieldFormat, { format: Intl.NumberFormat }>> = {
  integerFormat: { format: new Intl.NumberFormat(EN, { maximumFractionDigits: 0 }) },
  // Amounts in whatever currency the row names, without a symbol.
  currencyFormat: { format: new Intl.NumberFormat(EN, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) },
  decimalFormat: { format: new Intl.NumberFormat(EN, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) },
  percentageFormat: { format: new Intl.NumberFormat(EN, { style: 'percent', maximumFractionDigits: 1 }) },
};

// The field definition's format and, for numbers, the English formatter it uses.
const formatOf = (format: FieldFormat) =>
  format === 'usd'
    ? { format: 'currencyFormat' as const, formatOptions: USD }
    : { format, ...(NUMBER_OPTIONS[format] && { formatOptions: NUMBER_OPTIONS[format] }) };

const fields = (t: Translate, table: string, specs: FieldSpec[]): AgFieldDefinition[] =>
  specs.map(([id, format, hide]) => ({
    id,
    name: t(`data.fields.${table}.${id}`),
    ...formatOf(format),
    ...(hide && { hide }),
  }));

// Foreign key 'table.field' -> primary key 'table.field'.
const manyToOne = (id: string, source: string, target: string): AgRelationDefinition => {
  const [sourceTable, sourceField] = source.split('.');
  const [targetTable, targetField] = target.split('.');
  return {
    id,
    source: { tableId: sourceTable, fieldId: sourceField },
    target: { tableId: targetTable, fieldId: targetField },
    type: 'many-to-one',
  };
};

const onCalendar = (tableId: string, fieldId: string, truncate?: 'day'): AgRelationDefinition => ({
  id: `${tableId}-${fieldId}-calendar`,
  source: { tableId, fieldId },
  target: { calendarId: CALENDAR_ID },
  ...(truncate && { truncate }),
});

const sumOf = (id: string) => ({ id, aggregation: 'sum' as const });

const ratio = (
  id: string,
  name: string,
  description: string,
  numerator: string,
  denominator: string,
  denominatorAggregation: 'sum' | 'countd' = 'sum',
): AgExpressionFieldDefinition => ({
  id,
  name,
  description,
  ...formatOf('percentageFormat'),
  isMeasure: true,
  expression: { operator: 'divide', inputs: [sumOf(numerator), { id: denominator, aggregation: denominatorAggregation }] },
});

// A named total of one field, so chart legends read 'Blocked' rather than 'Blocked (sum)'.
const total = (id: string, name: string, description: string, field: string, format: FieldFormat = 'integerFormat'): AgExpressionFieldDefinition => ({
  id,
  name,
  description,
  isMeasure: true,
  expression: sumOf(field),
  ...formatOf(format),
});

// --- Data sources -----------------------------------------------------------------


// Whether the PayPal account has anything to report on. Without it, Studio would only show empty widgets.
export const hasData = (data: DashboardData) =>
  [data.invoices, data.transactions, data.products, data.plans, data.balances, data.guardDecisions].some((rows) => rows.length > 0);

// Names (tables, fields, measures) are in the app's language through `t`, the dashboard's messages
// (messages/<locale>/dashboard.json); descriptions stay in English, as they are mainly read by the AI.
export function buildStudioData(data: DashboardData, t: Translate): AgDataSourcesDefinition {
  const measure = (id: string) => t(`data.measures.${id}`);
  const dates = [
    ...data.invoices.map((r) => r.invoiceDate),
    ...data.invoicePayments.map((r) => r.date),
    ...data.transactions.map((r) => r.date?.slice(0, 10)),
    ...data.guardDecisions.map((r) => r.day),
  ]
    .filter((d): d is string => !!d)
    .sort();
  const today = data.asOf.slice(0, 10);

  return {
    description:
      'PayPal sandbox data fetched over the REST API for a merchant that sells subscription products and sends invoices. ' +
      'Invoices are in USD, EUR or GBP and are not converted, so filter by currency before summing money. ' +
      'Invoice payments are recorded externally (bank transfer, card, check, cash). The ledger holds payouts to affiliates, creators and customers.',
    sources: [
      {
        id: 'customers',
        name: t('data.tables.customers'),
        description: 'Invoice recipients, keyed by lower-cased email.',
        data: data.customers,
        fields: fields(t, 'customers', [
          ['id', 'textFormat', true],
          ['name', 'textFormat'],
          ['company', 'textFormat'],
          ['email', 'textFormat'],
        ]),
      },
      {
        id: 'invoices',
        name: t('data.tables.invoices'),
        description:
          'One row per invoice. Issued amount excludes drafts, scheduled and cancelled invoices. Outstanding and aging apply only to open or partially paid invoices.',
        data: data.invoices,
        fields: fields(t, 'invoices', [
          ['id', 'textFormat', true],
          ['number', 'textFormat'],
          ['customerId', 'textFormat', true],
          ['status', 'textFormat'],
          ['statusGroup', 'textFormat'],
          ['currency', 'textFormat'],
          ['paymentTerm', 'textFormat'],
          ['invoiceDate', 'dateFormat'],
          ['dueDate', 'dateFormat'],
          ['total', 'currencyFormat'],
          ['issuedAmount', 'currencyFormat'],
          ['paidAmount', 'currencyFormat'],
          ['refundedAmount', 'currencyFormat'],
          ['netCollected', 'currencyFormat'],
          ['isReceivable', 'booleanFormat'],
          ['outstanding', 'currencyFormat'],
          ['overdueAmount', 'currencyFormat'],
          ['daysOverdue', 'integerFormat'],
          ['agingBucket', 'textFormat'],
          ['daysToPay', 'integerFormat'],
          ['taxTotal', 'currencyFormat'],
        ]),
      },
      {
        id: 'invoiceItems',
        name: t('data.tables.invoiceItems'),
        description: 'Invoice lines. Line total is after line discount and tax, before invoice-level discount and shipping.',
        data: data.invoiceItems,
        fields: fields(t, 'invoiceItems', [
          ['id', 'textFormat', true],
          ['invoiceId', 'textFormat', true],
          ['name', 'textFormat'],
          ['unit', 'textFormat'],
          ['quantity', 'decimalFormat'],
          ['unitPrice', 'currencyFormat'],
          ['gross', 'currencyFormat'],
          ['discount', 'currencyFormat'],
          ['tax', 'currencyFormat'],
          ['lineTotal', 'currencyFormat'],
        ]),
      },
      {
        id: 'invoicePayments',
        name: t('data.tables.invoicePayments'),
        description: 'Payments and refunds recorded against invoices. Signed amount is negative for refunds; sum it for net cash.',
        data: data.invoicePayments,
        fields: fields(t, 'invoicePayments', [
          ['id', 'textFormat', true],
          ['invoiceId', 'textFormat', true],
          ['kind', 'textFormat'],
          ['method', 'textFormat'],
          ['date', 'dateFormat'],
          ['amount', 'currencyFormat'],
          ['signedAmount', 'currencyFormat'],
        ]),
      },
      {
        id: 'products',
        name: t('data.tables.products'),
        description: 'Catalog products sold as subscriptions.',
        data: data.products,
        fields: fields(t, 'products', [
          ['id', 'textFormat', true],
          ['name', 'textFormat'],
          ['type', 'textFormat'],
          ['category', 'textFormat'],
          ['description', 'textFormat'],
        ]),
      },
      {
        id: 'plans',
        name: t('data.tables.plans'),
        description: 'Subscription billing plans, in USD. Monthly price normalises weekly, quarterly and annual pricing to one month.',
        data: data.plans,
        fields: fields(t, 'plans', [
          ['id', 'textFormat', true],
          ['productId', 'textFormat', true],
          ['name', 'textFormat'],
          ['status', 'textFormat'],
          ['billingInterval', 'textFormat'],
          ['price', 'currencyFormat'],
          ['monthlyPrice', 'currencyFormat'],
          ['trialDays', 'integerFormat'],
          ['setupFee', 'currencyFormat'],
        ]),
      },
      {
        id: 'transactions',
        name: t('data.tables.transactions'),
        description:
          'Account ledger from Transaction Search, last 31 days. Amounts are signed (debits negative); net is amount plus fee. ' +
          'Sales is the amount of a payment a customer made to the shop, 0 for every other transaction. Money in and money out split the amount by direction, both positive.',
        data: data.transactions,
        fields: fields(t, 'transactions', [
          ['id', 'textFormat'],
          ['date', 'dateTimeFormat'],
          ['eventType', 'textFormat'],
          ['status', 'textFormat'],
          ['direction', 'textFormat'],
          ['currency', 'textFormat', true],
          ['amount', 'currencyFormat'],
          ['fee', 'currencyFormat'],
          ['net', 'currencyFormat'],
          ['sales', 'currencyFormat'],
          ['moneyIn', 'currencyFormat'],
          ['moneyOut', 'currencyFormat'],
          ['endingBalance', 'currencyFormat'],
          ['counterparty', 'textFormat'],
          ['note', 'textFormat'],
        ]),
      },
      {
        id: 'payouts',
        name: t('data.tables.payouts'),
        description: 'Individual payouts sent from the account, as positive USD amounts, grouped into campaigns.',
        data: data.payouts,
        fields: fields(t, 'payouts', [
          ['id', 'textFormat', true],
          ['campaign', 'textFormat'],
          ['recipient', 'textFormat'],
          ['date', 'dateTimeFormat'],
          ['status', 'textFormat'],
          ['amount', 'currencyFormat'],
          ['fee', 'currencyFormat'],
          ['note', 'textFormat'],
        ]),
      },
      {
        id: 'balances',
        name: t('data.tables.balances'),
        description: 'Current account balance per currency.',
        data: data.balances,
        fields: fields(t, 'balances', [
          ['currency', 'textFormat'],
          ['total', 'currencyFormat'],
          ['available', 'currencyFormat'],
          ['withheld', 'currencyFormat'],
        ]),
      },
      {
        id: 'guardDecisions',
        name: t('data.tables.guardDecisions'),
        description:
          'The newest 5,000 PayPal tool calls the shop\'s AI agents made through the payment guard, and the decisions people made on held actions. ' +
          'Agent is support (refunds, dispute acceptances, cancellations, order reads) or billing (invoices). Verdict is allow, hold or block. ' +
          'Money protected is the requested amount of blocked refunds (empty when the agent asked for a full refund without stating it) ' +
          'and the recorded amount of blocked dispute acceptances. Money moved is what refunds and dispute acceptances may have taken out of the account. ' +
          'Money billed is the total of invoices the billing agent created; it is billed, not yet paid. Awaiting approval is 1 for held actions no person has decided yet. ' +
          'Allowed, Held and Blocked are 1 under the decision\'s verdict and 0 otherwise; sum them to count decisions by verdict. All guard money is in USD.',
        data: data.guardDecisions,
        fields: fields(t, 'guardDecisions', [
          ['id', 'textFormat'],
          ['at', 'dateTimeFormat'],
          ['day', 'dateFormat'],
          ['tool', 'textFormat'],
          ['verdict', 'textFormat'],
          ['decision', 'textFormat'],
          ['outcome', 'textFormat'],
          ['customer', 'textFormat'],
          ['currency', 'textFormat'],
          ['requested', 'usd'],
          ['agent', 'textFormat'],
          ['action', 'textFormat'],
          ['moved', 'usd'],
          ['protected', 'usd'],
          ['billed', 'usd'],
          ['awaitingApproval', 'integerFormat'],
          ['allowed', 'integerFormat'],
          ['held', 'integerFormat'],
          ['blocked', 'integerFormat'],
          ['withheld', 'integerFormat'],
          ['decidedBy', 'textFormat'],
        ]).concat({
          // The decision's day as text (2026-10-22), for charts with one bar per day: Studio draws a
          // date field on a time axis, which labels only some days; a text field is one labelled
          // category per day, and this form sorts in date order.
          id: 'dayText',
          name: t('data.fields.guardDecisions.dayText'),
          format: 'textFormat',
          accessor: 'day',
        }),
      },
      {
        id: 'guardViolations',
        name: t('data.tables.guardViolations'),
        description: 'Each rule a guard decision broke, one row per rule; a decision can break several. Block Reason is the rule code in words.',
        data: data.guardViolations,
        fields: fields(t, 'guardViolations', [
          ['id', 'textFormat', true],
          ['decisionId', 'textFormat', true],
          ['code', 'textFormat'],
          ['reason', 'textFormat'],
          ['message', 'textFormat'],
        ]),
      },
    ],
    relationships: [
      manyToOne('invoice-customer', 'invoices.customerId', 'customers.id'),
      manyToOne('item-invoice', 'invoiceItems.invoiceId', 'invoices.id'),
      manyToOne('payment-invoice', 'invoicePayments.invoiceId', 'invoices.id'),
      manyToOne('plan-product', 'plans.productId', 'products.id'),
      onCalendar('invoices', 'invoiceDate'),
      onCalendar('invoicePayments', 'date'),
      onCalendar('transactions', 'date', 'day'),
      onCalendar('payouts', 'date', 'day'),
      manyToOne('violation-decision', 'guardViolations.decisionId', 'guardDecisions.id'),
      onCalendar('guardDecisions', 'day'),
    ],
    calendars: [
      {
        id: CALENDAR_ID,
        label: t('data.calendar'),
        range: {
          from: { type: 'date', value: dates[0] ?? today },
          to: { type: 'date', value: dates.at(-1) ?? today },
        },
        fragments: ['year', 'month', 'week', 'day', 'dayOfWeek'],
      },
    ],
    expressions: [
      ratio('collectionRate', measure('collectionRate'), 'Paid / invoiced. Filter to one currency first.', 'invoices.paidAmount', 'invoices.issuedAmount'),
      ratio('overdueShare', measure('overdueShare'), 'Share of outstanding receivables that is past due.', 'invoices.overdueAmount', 'invoices.outstanding'),
      ratio('refundRate', measure('refundRate'), 'Refunded / paid.', 'invoices.refundedAmount', 'invoices.paidAmount'),
      total('allowedCalls', measure('allowedCalls'), 'Calls the payment guard let through to PayPal.', 'guardDecisions.allowed'),
      total('heldCalls', measure('heldCalls'), 'Calls the payment guard held for a person.', 'guardDecisions.held'),
      total('blockedCalls', measure('blockedCalls'), 'Calls the payment guard stopped before PayPal.', 'guardDecisions.blocked'),
      total('moneyMoved', measure('moneyMoved'), 'Money allowed refunds and dispute acceptances took out of the account (USD).', 'guardDecisions.moved', 'usd'),
      total('moneyBilled', measure('moneyBilled'), 'Invoices the billing agent created (USD), not yet paid.', 'guardDecisions.billed', 'usd'),
      total('moneyProtected', measure('moneyProtected'), 'Money blocked refunds and dispute acceptances kept in the account (USD).', 'guardDecisions.protected', 'usd'),
      total('moneyInTotal', measure('moneyInTotal'), 'Credits on the PayPal ledger.', 'transactions.moneyIn', 'currencyFormat'),
      total('moneyOutTotal', measure('moneyOutTotal'), 'Debits on the PayPal ledger, as positive amounts.', 'transactions.moneyOut', 'currencyFormat'),
      total('salesTotal', measure('salesTotal'), 'Payments customers made to the shop.', 'transactions.sales', 'currencyFormat'),
      total('outstandingTotal', measure('outstandingTotal'), 'What customers still owe on sent invoices.', 'invoices.outstanding', 'currencyFormat'),
      total('overdueTotal', measure('overdueTotal'), 'The part of it past the due date.', 'invoices.overdueAmount', 'currencyFormat'),
      ratio('blockRate', measure('blockRate'), 'Share of the AI agents\' calls the payment guard blocked.', 'guardDecisions.blocked', 'guardDecisions.id', 'countd'),
    ],
  };
}
