import type { Metadata } from 'next';
import { connection } from 'next/server';
import type { ChainCheck } from '@/lib/guard/adapters/sqlite-audit-log';
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
      <p className="mt-3 rounded border border-pp-danger bg-pp-surface px-3 py-2 text-sm text-pp-danger">
        <strong>Black box tampered:</strong> row #{check.brokenAt} {check.reason}. Entries from there on cannot be trusted.
      </p>
    );
  }
  return (
    <p className="mt-3 rounded border border-pp-success bg-pp-surface px-3 py-2 text-sm text-pp-success">
      <strong>Black box intact:</strong> {check.records} hash-chained {check.records === 1 ? 'row' : 'rows'}, none altered, reordered
      or removed
      {check.head && (
        <>
          {' '}· head <code title={check.head}>{check.head.slice(0, 16)}…</code>. A log rewritten from scratch would also
          chain; keep a copy of this head elsewhere to catch that. New rows are checked on every visit, older ones in full at
          least once a minute.
        </>
      )}
    </p>
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
        customer: e.task.mandate.customerEmail,
        amount: amount?.value ? `${amount.value} ${amount.currency_code ?? ''}`.trim() : 'Full remaining amount',
        captureId: String(e.args.capture_id ?? ''),
        reasons: e.decision.violations.map((v) => v.message).join('; '),
      };
    });

  return (
    <EndpointPage
      title="Payment guard log"
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
        customer: e.task.mandate.customerEmail,
        reasons: e.decision.violations.map((v) => `${v.code}: ${v.message}`).join('; '),
        args: JSON.stringify(e.args),
        detail: e.detail,
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
