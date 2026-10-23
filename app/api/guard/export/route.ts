import { AUDIT_EXPORT_COLUMNS, auditExportRows, toCsv } from '@/lib/guard/audit-export';
import { auditLog } from '@/lib/guard/runtime';

// Downloads the payment guard's audit log (lib/guard/audit-export.ts), newest first, as CSV or
// JSON (?format=json). Behind the demo password like every route (proxy.ts).

// Far more than a demo writes; keeps one download bounded. A longer log downloads its newest rows
// with an X-Export-Truncated header.
const MAX_ROWS = 100_000;

export async function GET(request: Request) {
  const format = new URL(request.url).searchParams.get('format') ?? 'csv';
  if (format !== 'csv' && format !== 'json') {
    return Response.json({ error: { message: 'format must be csv or json.' } }, { status: 400 });
  }
  let entries;
  try {
    // One row more than fits tells whether the log was cut.
    entries = auditLog().list(MAX_ROWS + 1);
  } catch (cause) {
    // The cause can name the database file, so it stays in the server log.
    console.error('Guard log export failed', cause);
    return Response.json({ error: { message: 'The guard log could not be read. Details are in the server log.' } }, { status: 503 });
  }
  const truncated = entries.length > MAX_ROWS;
  const rows = auditExportRows(entries.slice(0, MAX_ROWS));
  const filename = `guard-log-${new Date().toISOString().slice(0, 10)}.${format}`;
  const body = format === 'csv' ? toCsv(rows, AUDIT_EXPORT_COLUMNS) : JSON.stringify(rows, null, 2);
  return new Response(body, {
    headers: {
      'content-type': format === 'csv' ? 'text/csv; charset=utf-8' : 'application/json; charset=utf-8',
      'content-disposition': `attachment; filename="${filename}"`,
      ...(truncated && { 'x-export-truncated': 'true' }),
    },
  });
}
