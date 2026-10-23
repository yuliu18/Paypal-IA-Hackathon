import { describe, expect, it } from 'vitest';
import type { AuditRow } from './ports';
import { auditExportRows, toCsv } from './audit-export';

const task = { mandate: { customerEmail: 'ana@example.com' }, instructions: 'Refund damaged items only.', untrustedInput: 'Broken mug.' };

const row = (overrides: Partial<AuditRow> & { id: string }): AuditRow => ({
  at: '2026-10-21T10:00:00.000Z',
  tool: 'create_refund',
  args: { capture_id: 'CAP-1', amount: { value: '25.00', currency_code: 'USD' } },
  task,
  decision: { verdict: 'allow', violations: [] },
  outcome: 'executed',
  moved: { minor: 2500, currency: 'USD' },
  ...overrides,
});

describe('auditExportRows', () => {
  it('turns each logged call into one row with its outcome, amount and masked customer', () => {
    expect(auditExportRows([row({ id: '1' })])).toEqual([
      {
        id: '1',
        at: '2026-10-21T10:00:00.000Z',
        tool: 'create_refund',
        outcome: 'executed',
        verdict: 'allow',
        decidedBy: 'all checks passed',
        customer: 'a***@example.com',
        moved: 25,
        currency: 'USD',
        codes: '',
        reasons: '',
        decides: '',
        detail: '',
      },
    ]);
  });

  it('says who decided: the policy, the intent judge, both, or a person', () => {
    const rows = auditExportRows([
      row({ id: '1', outcome: 'blocked', decision: { verdict: 'block', violations: [{ code: 'CUSTOMER_MISMATCH', message: 'Not her order' }] } }),
      row({ id: '2', outcome: 'blocked', decision: { verdict: 'block', violations: [{ code: 'INTENT_MISMATCH', message: 'Injected' }] } }),
      row({ id: '3', outcome: 'held', decision: { verdict: 'hold', violations: [{ code: 'INTENT_UNCERTAIN', message: 'Unclear' }] } }),
      row({ id: '4', outcome: 'blocked', decision: { verdict: 'block', violations: [{ code: 'INTENT_JUDGE_UNAVAILABLE', message: 'Timeout' }] } }),
      row({
        id: '5',
        outcome: 'blocked',
        decision: { verdict: 'block', violations: [{ code: 'DAILY_LIMIT', message: 'Over' }, { code: 'INTENT_MISMATCH', message: 'Injected' }] },
      }),
      row({ id: '6', resolves: '3', decision: { verdict: 'allow', violations: [{ code: 'APPROVED_BY_PERSON', message: 'Approved' }] } }),
      row({ id: '7', tool: 'list_transactions', args: {}, outcome: 'blocked', decision: { verdict: 'block', violations: [{ code: 'TOOL_NOT_ALLOWED', message: 'No' }] } }),
    ]);
    expect(rows.map((r) => [r.id, r.decidedBy])).toEqual([
      ['1', 'policy'],
      ['2', 'intent judge'],
      ['3', 'intent judge'],
      ['4', 'intent judge'],
      ['5', 'policy and intent judge'],
      ['6', 'person'],
      ['7', 'policy'],
    ]);
    expect(rows[5].decides).toBe('3');
    expect(rows[4].codes).toBe('DAILY_LIMIT; INTENT_MISMATCH');
  });

  it('masks personal data in reasons and detail, and leaves moved empty when nothing moved', () => {
    const [exported] = auditExportRows([
      row({
        id: '1',
        outcome: 'blocked',
        moved: undefined,
        decision: { verdict: 'block', violations: [{ code: 'CUSTOMER_MISMATCH', message: 'Order belongs to ben@example.com' }] },
        detail: 'Card 4111 1111 1111 1111 on file',
      }),
    ]);
    expect(exported.moved).toBeNull();
    expect(exported.currency).toBe('');
    expect(exported.reasons).not.toContain('ben@example.com');
    expect(exported.detail).not.toContain('4111 1111 1111 1111');
  });
});

describe('toCsv', () => {
  it('writes a header and one line per row, quoting commas, quotes and line breaks', () => {
    const csv = toCsv([
      { id: '1', note: 'plain', amount: 25 },
      { id: '2', note: 'a, "quoted"\nline', amount: null },
    ]);
    expect(csv).toBe('id,note,amount\r\n1,plain,25\r\n2,"a, ""quoted""\nline",\r\n');
  });

  it('neutralises cells a spreadsheet would run as a formula, since ticket text comes from customers', () => {
    const csv = toCsv([{ reason: '=HYPERLINK("http://evil")' }, { reason: '+1' }, { reason: '-2' }, { reason: '@SUM(A1)' }]);
    expect(csv.split('\r\n').slice(1, 5)).toEqual([`"'=HYPERLINK(""http://evil"")"`, "'+1", "'-2", "'@SUM(A1)"]);
  });

  it('writes only the header when there are no rows', () => {
    expect(toCsv([], ['id', 'at'])).toBe('id,at\r\n');
  });
});
