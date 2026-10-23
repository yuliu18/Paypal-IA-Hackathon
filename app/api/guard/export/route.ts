import { AUDIT_EXPORT_COLUMNS, auditExportRows, toCsv } from '@/lib/guard/audit-export';
import { auditLog } from '@/lib/guard/runtime';

// Downloads the payment guard's audit log (lib/guard/audit-export.ts), newest first, as CSV or
// JSON (?format=json). Behind the demo password like every route (proxy.ts).

// Far more than a demo writes; keeps one download bounded.
const MAX_ROWS = 100_000;

export async function GET(request: Request) {
  const format = new URL(request.url).searchParams.get('format') ?? 'csv';
  if (format !== 'csv' && format !== 'json') {
    return Response.json({ error: { message: 'format must be csv or json.' } }, { status: 400 });
  }
  const rows = auditExportRows(auditLog().list(MAX_ROWS));
  const filename = `guard-log-${new Date().toISOString().slice(0, 10)}.${format}`;
  const body = format === 'csv' ? toCsv(rows, AUDIT_EXPORT_COLUMNS) : JSON.stringify(rows, null, 2);
  return new Response(body, {
    headers: {
      'content-type': format === 'csv' ? 'text/csv; charset=utf-8' : 'application/json; charset=utf-8',
      'content-disposition': `attachment; filename="${filename}"`,
    },
  });
}
