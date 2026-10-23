// The guard's audit log as a downloadable file (CSV or JSON): one row per decision, saying who
// decided it and what happened. Emails and cards are masked, as on the guard log page.

import { maskEmail, maskPersonalData } from './domain/redact';
import type { AuditRow } from './ports';

// Violation codes the LLM intent judge produces (lib/guard/adapters/llm-intent-judge.ts); every
// other code comes from the deterministic checks.
const JUDGE_CODES = new Set(['INTENT_MISMATCH', 'INTENT_UNCERTAIN', 'INTENT_JUDGE_UNAVAILABLE']);

export type AuditExportRow = {
  id: string;
  at: string;
  tool: string;
  outcome: string;
  verdict: string;
  decidedBy: 'person' | 'policy' | 'intent judge' | 'policy and intent judge' | 'all checks passed';
  customer: string;
  // Major units; null when no money moved.
  moved: number | null;
  currency: string;
  codes: string;
  reasons: string;
  // The held entry a person's decision resolves.
  decides: string;
  detail: string;
};

export const AUDIT_EXPORT_COLUMNS: (keyof AuditExportRow)[] = [
  'id', 'at', 'tool', 'outcome', 'verdict', 'decidedBy', 'customer', 'moved', 'currency', 'codes', 'reasons', 'decides', 'detail',
];

function decidedBy(entry: AuditRow): AuditExportRow['decidedBy'] {
  if (entry.resolves) return 'person';
  const codes = entry.decision.violations.map((v) => v.code);
  if (codes.length === 0) return 'all checks passed';
  const judge = codes.some((code) => JUDGE_CODES.has(code));
  const policy = codes.some((code) => !JUDGE_CODES.has(code));
  return judge && policy ? 'policy and intent judge' : judge ? 'intent judge' : 'policy';
}

export function auditExportRows(entries: AuditRow[]): AuditExportRow[] {
  return entries.map((e) => ({
    id: e.id,
    at: e.at,
    tool: e.tool,
    outcome: e.outcome,
    verdict: e.decision.verdict,
    decidedBy: decidedBy(e),
    customer: maskEmail(e.task.mandate.customerEmail),
    moved: e.moved ? e.moved.minor / 100 : null,
    currency: e.moved?.currency ?? '',
    codes: e.decision.violations.map((v) => v.code).join('; '),
    reasons: maskPersonalData(e.decision.violations.map((v) => v.message).join('; ')),
    decides: e.resolves ?? '',
    detail: e.detail ? maskPersonalData(e.detail) : '',
  }));
}

// A spreadsheet runs a cell starting with one of these as a formula; reasons can echo ticket text.
const FORMULA_START = /^[=+\-@\t\r]/;

function csvCell(value: unknown): string {
  if (value === null || value === undefined) return '';
  let text = String(value);
  if (typeof value === 'string' && FORMULA_START.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

// RFC 4180 lines (CRLF). `columns` defaults to the first row's keys.
export function toCsv(rows: Record<string, unknown>[], columns: string[] = Object.keys(rows[0] ?? {})): string {
  const lines = [columns.map(csvCell).join(','), ...rows.map((row) => columns.map((c) => csvCell(row[c])).join(','))];
  return `${lines.join('\r\n')}\r\n`;
}
