import type { Metadata } from 'next';
import { connection } from 'next/server';
import { getTranslations } from 'next-intl/server';
import type { ChainCheck } from '@/lib/guard/ports';
import { parseInvoiceDraft } from '@/lib/guard/domain/invoice';
import { parseOrderDraft } from '@/lib/guard/domain/order';
import { format } from '@/lib/guard/domain/policy';
import { maskEmail, maskPersonalData } from '@/lib/guard/domain/redact';
import { auditLog } from '@/lib/guard/runtime';
import { liveModeStatus } from '@/lib/settings/live-mode';
import { loadSettings } from '@/lib/settings/settings';
import { LiveIndicator } from '../../_overview/live-indicator';
import { EndpointPage } from '../endpoint-page';
import { GuardAssistant } from './guard-assistant';
import { HeldQueue, type HeldCall } from './held-queue';

const FULL_CHECK_MS = 60_000;

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations('guard'))('title') };
}

// The black box checked on every visit: rows added since the last full check are re-hashed and
// linked, and the whole chain at least once a minute (FULL_CHECK_MS).
async function ChainStatus({ check }: { check: ChainCheck }) {
  const t = await getTranslations('guard.chain');
  if (!check.intact) {
    return (
      <p className="mt-4 rounded border border-pp-danger bg-pp-surface px-3 py-2 text-sm text-pp-danger">
        {t.rich('tampered', { row: check.brokenAt, reason: check.reason, strong: (chunks) => <strong>{chunks}</strong> })}
      </p>
    );
  }
  const how = [t('howChain'), t('howCheck'), check.head && t('howHead', { head: check.head.slice(0, 16) })];
  return (
    <span
      title={how.filter(Boolean).join(' ')}
      className="inline-flex cursor-help items-center gap-1.5 rounded-md border border-pp-success/40 bg-pp-success-tint px-3 py-1.5 text-sm font-semibold text-pp-success"
    >
      <svg viewBox="0 0 24 24" className="size-4 fill-none stroke-current" strokeWidth={2.2} aria-hidden>
        <path d="M5 12l4 4 10-10" />
      </svg>
      {t('intact', { count: check.records })}
    </span>
  );
}

// What the guard did in the decisions shown, the same three verdicts as everywhere else.
async function Tally({ entries, passed, waiting, stopped }: { entries: number; passed: number; waiting: number; stopped: number }) {
  const t = await getTranslations('guard.tally');
  const figures = [
    { key: 'passed', n: passed, label: t('passed'), dot: 'bg-pp-success' },
    { key: 'waiting', n: waiting, label: t('waiting', { count: waiting }), dot: 'bg-pp-warning' },
    { key: 'stopped', n: stopped, label: t('stopped'), dot: 'bg-pp-danger' },
  ];
  return (
    <div className="mt-6 flex flex-wrap items-baseline gap-x-8 gap-y-2">
      <p className="text-sm text-pp-muted">{t('latest', { count: entries })}</p>
      {figures.map((f) => (
        <p key={f.key} className="flex items-baseline gap-2">
          <span className={`size-2.5 self-center rounded-full ${f.dot}`} aria-hidden />
          <span className="text-2xl font-semibold">{t('figure', { n: f.n })}</span>
          <span className="text-sm text-pp-muted">{f.label}</span>
        </p>
      ))}
    </div>
  );
}

// The whole log as a file (app/api/guard/export), not only the latest rows shown here.
async function DownloadLink({ format }: { format: 'csv' | 'json' }) {
  const t = await getTranslations('guard.download');
  return (
    <a
      href={`/api/guard/export?format=${format}`}
      download
      title={t('title')}
      className="rounded-md border border-pp-border bg-pp-surface px-3 py-1.5 text-sm font-semibold text-pp-ink hover:border-pp-blue"
    >
      {t('label', { format: format.toUpperCase() })}
    </a>
  );
}

export default async function GuardLogPage() {
  await connection();
  const t = await getTranslations('guard');
  const log = auditLog();
  const [entries, chain, settings] = await Promise.all([log.list(500), log.verifyChain(FULL_CHECK_MS), loadSettings()]);
  const live = liveModeStatus(settings);
  const environmentOf = (e: { environment?: string }) => (e.environment === 'live' ? ('live' as const) : ('sandbox' as const));
  const decided = new Set(entries.flatMap((e) => (e.resolves ? [e.resolves] : [])));
  const held: HeldCall[] = entries
    .filter((e) => e.outcome === 'held' && !decided.has(e.id))
    .map((e) => {
      const common = {
        id: e.id,
        at: e.at,
        customer: maskEmail(e.task.mandate.customerEmail),
        environment: environmentOf(e),
        codes: e.decision.violations.map((v) => v.code),
        // One sentence per reason.
        reasons: maskPersonalData(e.decision.violations.map((v) => (/[.!?]$/.test(v.message) ? v.message : `${v.message}.`)).join(' ')),
      };
      if (e.tool === 'cancel_subscription') {
        return { ...common, kind: 'cancellation' as const, subscriptionId: maskPersonalData(String(e.args.subscription_id ?? '')) };
      }
      if (e.tool === 'accept_dispute_claim') {
        return { ...common, kind: 'dispute' as const, disputeId: maskPersonalData(String(e.args.dispute_id ?? '')) };
      }
      if (e.tool === 'create_invoice') {
        // The total the guard computed from the items, not a figure the agent wrote.
        const parsed = parseInvoiceDraft(e.args);
        return { ...common, kind: 'invoice' as const, amount: 'draft' in parsed ? format(parsed.draft.total) : t('amount.unreadable') };
      }
      if (e.tool === 'create_order') {
        // The total the guard computed from the items, not a figure the agent wrote.
        const parsed = parseOrderDraft(e.args);
        return { ...common, kind: 'order' as const, amount: 'draft' in parsed ? format({ minor: parsed.draft.totalMinor, currency: parsed.draft.currency }) : t('amount.unreadable') };
      }
      if (e.tool === 'send_invoice' || e.tool === 'send_invoice_reminder') {
        const kind = e.tool === 'send_invoice' ? ('invoice-sending' as const) : ('invoice-reminder' as const);
        return { ...common, kind, invoiceId: maskPersonalData(String(e.args.invoice_id ?? '')) };
      }
      const amount = e.args.amount as { value?: string; currency_code?: string } | undefined;
      return {
        ...common,
        kind: 'refund' as const,
        amount: amount?.value ? `${amount.value} ${amount.currency_code ?? ''}`.trim() : t('amount.fullRemaining'),
        captureId: String(e.args.capture_id ?? ''),
      };
    });

  const count = (outcome: string) => entries.filter((e) => !e.resolves && e.outcome === outcome).length;

  return (
    <EndpointPage
      title={t('title')}
      summary={t('summary')}
      aside={
        <div className="flex flex-wrap items-center gap-2">
          {chain.intact && <ChainStatus check={chain} />}
          <DownloadLink format="csv" />
          <DownloadLink format="json" />
        </div>
      }
      rows={entries.map((e) => ({
        id: e.id,
        at: e.at,
        tool: e.tool,
        outcome: e.outcome,
        verdict: e.decision.verdict,
        amount: e.moved ? e.moved.minor / 100 : null,
        currency: e.moved?.currency,
        // The black box keeps the full record; the screen shows it masked.
        customer: maskEmail(e.task.mandate.customerEmail),
        reasons: maskPersonalData(e.decision.violations.map((v) => `${v.code}: ${v.message}`).join('; ')),
        args: maskPersonalData(JSON.stringify(e.args)),
        detail: e.detail && maskPersonalData(e.detail),
        decides: e.resolves ? `#${e.resolves}` : null,
        environment: t(`environment.${environmentOf(e)}`),
      }))}
      columns={[
        { field: 'id', headerName: t('columns.id') },
        { field: 'at', headerName: t('columns.at'), cellDataType: 'dateTimeString', sort: 'desc' },
        // Next to the time, so a live (real money) decision stands out without scrolling.
        { field: 'environment', headerName: t('columns.environment') },
        { field: 'tool', headerName: t('columns.tool') },
        { field: 'outcome', headerName: t('columns.outcome') },
        { field: 'verdict', headerName: t('columns.verdict') },
        { field: 'amount', headerName: t('columns.amount'), type: 'money' },
        { field: 'customer', headerName: t('columns.customer') },
        { field: 'reasons', headerName: t('columns.reasons') },
        { field: 'args', headerName: t('columns.args') },
        { field: 'detail', headerName: t('columns.detail') },
        { field: 'decides', headerName: t('columns.decides') },
      ]}
    >
      {live.active && <LiveIndicator state="on" text={t('liveMode.on')} settingsLabel={t('liveMode.settings')} />}
      {live.mode === 'live' && !live.active && <LiveIndicator state="failClosed" text={t('liveMode.failClosed')} settingsLabel={t('liveMode.settings')} />}
      {!chain.intact && <ChainStatus check={chain} />}
      <Tally entries={entries.length} passed={count('executed')} waiting={held.length} stopped={count('blocked')} />
      <div className="mt-8 grid items-start gap-8 xl:grid-cols-[minmax(0,1fr)_24rem]">
        <HeldQueue calls={held} />
        <GuardAssistant />
      </div>
    </EndpointPage>
  );
}
