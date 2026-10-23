// The message every held-refund channel sends (webhook, email, Telegram), and the scrubbing of
// secrets from the errors they log. The message never quotes the ticket or any other text an
// outsider wrote: chat apps and mail clients turn it into links and mentions.

import { maskEmail } from '../domain/redact';
import type { AuditRow } from '../ports';

const MONEY_VALUE = /^\d+(\.\d{1,2})?$/;
const CURRENCY = /^[A-Z]{3}$/;
const CODE = /^[A-Z][A-Z0-9_]{0,63}$/;

// The amount as the agent asked for it, only when it is a plain amount and currency code.
function amountOf(args: Record<string, unknown>): string {
  if (args.amount === undefined) return 'the full remaining amount';
  const amount = args.amount as { currency_code?: unknown; value?: unknown };
  const ok = typeof amount?.value === 'string' && MONEY_VALUE.test(amount.value) && typeof amount.currency_code === 'string' && CURRENCY.test(amount.currency_code);
  return ok ? `${amount.value} ${amount.currency_code}` : 'an unreadable amount';
}

// The ticket's email is typed by the customer: masked, and stripped of anything chat markup uses.
const plain = (text: string) => text.replace(/[^\p{L}\p{N}@.*_+-]/gu, '').slice(0, 120);

function guardLink(appUrl: string | undefined): string {
  const base = appUrl?.trim().replace(/\/+$/, '');
  return base && /^https?:\/\/[^\s]+$/i.test(base) && URL.canParse(base) ? `${base}/guard` : '/guard';
}

export function heldMessage(entry: AuditRow, appUrl?: string): string {
  const codes = entry.decision.violations.map((v) => v.code).filter((code) => CODE.test(code));
  return [
    `Payment guard: a refund of ${amountOf(entry.args)} is waiting for approval.`,
    `Customer: ${plain(maskEmail(entry.task.mandate.customerEmail))}.`,
    `Reasons: ${codes.join(', ') || 'none given'}.`,
    `Audit entry #${plain(entry.id)}.`,
    `Approve or reject it on ${guardLink(appUrl)}`,
  ].join('\n');
}

// An error as text with every secret (a token, a key, a URL that carries one) replaced by `label`.
export function withoutSecrets(error: unknown, secrets: string[], label: string): string {
  const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  return secrets.filter(Boolean).reduce((text, secret) => text.split(secret).join(label), message);
}
