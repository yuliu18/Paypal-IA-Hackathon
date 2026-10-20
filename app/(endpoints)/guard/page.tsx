import type { Metadata } from 'next';
import { connection } from 'next/server';
import { auditLog } from '@/lib/guard/runtime';
import { EndpointPage } from '../endpoint-page';

export const metadata: Metadata = { title: 'Payment guard log' };

export default async function GuardLogPage() {
  await connection();
  const entries = auditLog().list(500);

  return (
    <EndpointPage
      title="Payment guard log"
      calls={['MCP create_refund', 'MCP get_order', 'MCP get_refund']}
      source="lib/guard/guard.ts"
      note="Every tool call the AI agent made through the payment guard, newest first. Blocked calls never reached PayPal; pending means the call was logged before running and never settled, so its amount still counts toward the daily limit."
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
      }))}
      columns={[
        { field: 'at', headerName: 'Time', cellDataType: 'dateTimeString', sort: 'desc' },
        { field: 'tool', headerName: 'Tool' },
        { field: 'outcome', headerName: 'Outcome' },
        { field: 'verdict', headerName: 'Verdict' },
        { field: 'amount', headerName: 'Amount', type: 'money' },
        { field: 'customer', headerName: 'Ticket customer' },
        { field: 'reasons', headerName: 'Reasons' },
        { field: 'args', headerName: 'Arguments' },
        { field: 'detail', headerName: 'Detail' },
      ]}
    />
  );
}
