import type { Metadata } from 'next';
import { connection } from 'next/server';
import type { ChainCheck } from '@/lib/guard/adapters/sqlite-audit-log';
import { maskEmail, maskPersonalData } from '@/lib/guard/domain/redact';
import { auditLog } from '@/lib/guard/runtime';
import { EndpointPage } from '../endpoint-page';
import { HeldQueue, type HeldCall } from './held-queue';

const FULL_CHECK_MS = 60_000;

export const metadata: Metadata = { title: 'Payment guard log' };

// The black box checked on every visit: rows added since the last full check are re-hashed and
// linked, and the whole chain at least once a minute (FULL_CHECK_MS).
function ChainStatus({ check }: { check: ChainCheck }) {
  if (!check.intact) {
    return (
      <p className="mt-4 rounded border border-pp-danger bg-pp-surface px-3 py-2 text-sm text-pp-danger">
        <strong>Black box tampered:</strong> row #{check.brokenAt} {check.reason}. Entries from there on cannot be trusted.
      </p>
    );
  }
  const how = [
    'Every row carries the hash of the one before it, so an edited, reordered or deleted row breaks the chain.',
    'New rows are checked on every visit, older ones in full at least once a minute.',
    check.head && `A log rewritten from scratch would also chain: keep a copy of the head ${check.head.slice(0, 16)}… elsewhere to catch that.`,
  ];
  return (
    <span
      title={how.filter(Boolean).join(' ')}
      className="inline-flex cursor-help items-center gap-1.5 rounded-full bg-pp-success/10 px-3 py-1 text-sm font-semibold text-pp-success"
    >
      <svg viewBox="0 0 24 24" className="size-4 fill-none stroke-current" strokeWidth={2.2} aria-hidden>
        <path d="M5 12l4 4 10-10" />
      </svg>
      Black box intact · {check.records} {check.records === 1 ? 'row' : 'rows'}
    </span>
  );
}

// The whole log as a file (app/api/guard/export), not only the latest rows shown here.
function DownloadLink({ format }: { format: 'csv' | 'json' }) {
  return (
    <a
      href={`/api/guard/export?format=${format}`}
      download
      title="Every decision of the guard, with who decided it. Emails and cards are masked."
      className="rounded border border-pp-border bg-pp-surface px-3 py-1.5 text-sm font-semibold text-pp-navy hover:bg-pp-highlight"
    >
      Download {format.toUpperCase()}
    </a>
  );
}

export default async function GuardLogPage() {
  await connection();
  const log = auditLog();
  const entries = log.list(500);
  const chain = log.verifyChain(FULL_CHECK_MS);
  const decided = new Set(entries.flatMap((e) => (e.resolves ? [e.resolves] : [])));
  const held: HeldCall[] = entries
    .filter((e) => e.outcome === 'held' && !decided.has(e.id))
    .map((e) => {
      const common = {
        id: e.id,
        at: e.at,
        customer: maskEmail(e.task.mandate.customerEmail),
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
      const amount = e.args.amount as { value?: string; currency_code?: string } | undefined;
      return {
        ...common,
        kind: 'refund' as const,
        amount: amount?.value ? `${amount.value} ${amount.currency_code ?? ''}`.trim() : 'Full remaining amount',
        captureId: String(e.args.capture_id ?? ''),
      };
    });

  return (
    <EndpointPage
      title="Payment guard log"
      summary={`The latest ${entries.length} decisions of the payment guard, newest first. Blocked and held calls never reached PayPal.`}
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
      }))}
      columns={[
        { field: 'id', headerName: '#' },
        { field: 'at', headerName: 'Time', cellDataType: 'dateTimeString', sort: 'desc' },
        { field: 'tool', headerName: 'Tool' },
        { field: 'outcome', headerName: 'Outcome' },
        { field: 'verdict', headerName: 'Verdict' },
        { field: 'amount', headerName: 'Amount', type: 'money' },
        { field: 'customer', headerName: 'Ticket customer' },
        { field: 'reasons', headerName: 'Reasons' },
        { field: 'args', headerName: 'Arguments' },
        { field: 'detail', headerName: 'Detail' },
        { field: 'decides', headerName: 'Decides held entry' },
      ]}
    >
      {!chain.intact && <ChainStatus check={chain} />}
      <HeldQueue calls={held} />
    </EndpointPage>
  );
}
