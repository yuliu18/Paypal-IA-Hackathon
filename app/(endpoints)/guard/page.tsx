import type { Metadata } from 'next';
import { connection } from 'next/server';
import type { ChainCheck } from '@/lib/guard/adapters/sqlite-audit-log';
import { maskEmail, maskPersonalData } from '@/lib/guard/domain/redact';
import { auditLog } from '@/lib/guard/runtime';
import { EndpointPage } from '../endpoint-page';
import { HeldQueue, type HeldRefund } from './held-queue';

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
  return (
    <div className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
      <span className="inline-flex items-center gap-1.5 rounded-full bg-pp-success/10 px-3 py-1 font-semibold text-pp-success">
        <svg viewBox="0 0 24 24" className="size-4 fill-none stroke-current" strokeWidth={2.2} aria-hidden>
          <path d="M5 12l4 4 10-10" />
        </svg>
        Black box intact
      </span>
      <span className="text-pp-muted">
        {check.records} hash-chained {check.records === 1 ? 'row' : 'rows'}, none altered, reordered or removed
      </span>
      <details className="w-full text-pp-muted">
        <summary className="cursor-pointer select-none text-xs font-semibold text-pp-blue">How is this checked?</summary>
        <p className="mt-1 max-w-3xl text-xs">
          Every row carries the hash of the one before it. New rows are checked on every visit, older ones in full at least once a minute.
          {check.head && (
            <>
              {' '}A log rewritten from scratch would also chain: keep a copy of the current head <code title={check.head}>{check.head.slice(0, 16)}…</code>{' '}
              elsewhere to catch that.
            </>
          )}
        </p>
      </details>
    </div>
  );
}

export default async function GuardLogPage() {
  await connection();
  const log = auditLog();
  const entries = log.list(500);
  const chain = log.verifyChain(FULL_CHECK_MS);
  const decided = new Set(entries.flatMap((e) => (e.resolves ? [e.resolves] : [])));
  const held: HeldRefund[] = entries
    .filter((e) => e.outcome === 'held' && !decided.has(e.id))
    .map((e) => {
      const amount = e.args.amount as { value?: string; currency_code?: string } | undefined;
      return {
        id: e.id,
        at: e.at,
        customer: maskEmail(e.task.mandate.customerEmail),
        amount: amount?.value ? `${amount.value} ${amount.currency_code ?? ''}`.trim() : 'Full remaining amount',
        captureId: String(e.args.capture_id ?? ''),
        codes: e.decision.violations.map((v) => v.code),
        // One sentence per reason.
        reasons: maskPersonalData(e.decision.violations.map((v) => (/[.!?]$/.test(v.message) ? v.message : `${v.message}.`)).join(' ')),
      };
    });

  return (
    <EndpointPage
      title="Payment guard log"
      summary={`The latest ${entries.length} decisions of the payment guard, newest first.`}
      calls={['MCP create_refund', 'MCP get_order']}
      source="lib/guard/guard.ts"
      note="Every tool call the AI agent made through the payment guard, newest first, and every decision a person made on a held refund. Blocked and held calls never reached PayPal; pending means the call was logged before running and never settled, so its amount still counts toward the daily limit. The log is append-only and hash-chained, so any edited or deleted row shows up below."
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
      <ChainStatus check={chain} />
      <HeldQueue refunds={held} />
    </EndpointPage>
  );
}
