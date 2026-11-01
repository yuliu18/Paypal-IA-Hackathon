import { describe, expect, it, vi } from 'vitest';
import type { AuditRow } from '@/lib/guard/ports';

const entries: AuditRow[] = [
  {
    id: '1',
    at: '2026-10-21T10:00:00.000Z',
    tool: 'create_refund',
    args: { capture_id: 'CAP-1' },
    task: { mandate: { customerEmail: 'ana@example.com' }, instructions: '', untrustedInput: '' },
    decision: { verdict: 'block', violations: [{ code: 'CUSTOMER_MISMATCH', message: 'Not her order' }] },
    outcome: 'blocked',
  },
];
const list = vi.fn<(limit: number) => AuditRow[]>(() => entries);
vi.mock('@/lib/guard/runtime', () => ({ auditLog: () => ({ list }) }));

const { GET } = await import('./route');
const get = (query = '') => GET(new Request(`http://test/api/guard/export${query}`));

describe('GET /api/guard/export', () => {
  it('downloads the whole log as CSV by default', async () => {
    const res = await get();
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('text/csv; charset=utf-8');
    expect(res.headers.get('content-disposition')).toMatch(/^attachment; filename="guard-log-\d{4}-\d{2}-\d{2}\.csv"$/);
    const [header, line] = (await res.text()).split('\r\n');
    expect(header).toBe('id,at,tool,outcome,verdict,decidedBy,customer,moved,currency,codes,reasons,decides,detail,environment');
    expect(line).toBe('1,2026-10-21T10:00:00.000Z,create_refund,blocked,block,policy,a***@example.com,,,CUSTOMER_MISMATCH,Not her order,,,sandbox');
  });

  it('downloads JSON when asked', async () => {
    const res = await get('?format=json');
    expect(res.headers.get('content-type')).toBe('application/json; charset=utf-8');
    expect(res.headers.get('content-disposition')).toMatch(/guard-log-\d{4}-\d{2}-\d{2}\.json"$/);
    const body = await res.json();
    expect(body).toEqual([expect.objectContaining({ id: '1', decidedBy: 'policy', customer: 'a***@example.com' })]);
  });

  it('says so in a header when the log has more rows than one download holds', async () => {
    list.mockImplementationOnce((limit: number) => Array.from({ length: limit }, (_, i) => ({ ...entries[0], id: String(i) })));
    const res = await get('?format=json');
    expect(res.headers.get('x-export-truncated')).toBe('true');
    expect((await res.json()).length).toBe(list.mock.calls.at(-1)![0] - 1);
    expect((await get()).headers.get('x-export-truncated')).toBeNull();
  });

  it('answers 503 with a plain message when the log cannot be read', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    list.mockImplementationOnce(() => {
      throw new Error('SQLITE_BUSY at /data/guard-audit.db');
    });
    const res = await get();
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: { message: 'The guard log could not be read. Details are in the server log.' } });
    expect(log).toHaveBeenCalledWith('Guard log export failed', expect.any(Error));
    log.mockRestore();
  });

  it('rejects an unknown format', async () => {
    const res = await get('?format=xlsx');
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: { message: 'format must be csv or json.' } });
  });
});
