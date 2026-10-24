// The message every held-action channel sends (webhook, email, Telegram), and the scrubbing of
// secrets from the errors they log. The message never quotes the ticket or any other text an
// outsider wrote: chat apps and mail clients turn it into links and mentions.

import { SUBSCRIPTION_ID } from '../domain/cancellation';
import { DISPUTE_ID } from '../domain/dispute';
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

// What a person is asked to approve, by tool; the refund wording is unchanged from before cancellations.
function heldAction(entry: AuditRow): string {
  if (entry.tool === 'cancel_subscription') {
    const id = entry.args.subscription_id;
    return `a subscription cancellation (${typeof id === 'string' && SUBSCRIPTION_ID.test(id) ? id : 'unreadable id'})`;
  }
  if (entry.tool === 'accept_dispute_claim') {
    // The disputed amount is PayPal's, not in the arguments; /guard shows it in the reasons.
    const id = entry.args.dispute_id;
    return `a dispute claim acceptance (${typeof id === 'string' && DISPUTE_ID.test(id) ? id : 'unreadable id'}), which refunds the disputed amount,`;
  }
  return `a refund of ${amountOf(entry.args)}`;
}

// A security filter, not formatting: the ticket's email is typed by the customer, so after masking
// only letters, digits and @.*_+- survive. Anything else could become a link or mention in chat.
const sanitized = (text: string) => text.replace(/[^\p{L}\p{N}@.*_+-]/gu, '').slice(0, 120);

// Only well-formed codes are quoted; the rest are counted, so a hold never reads as having no reason.
function reasonsOf(codes: string[]): string {
  if (codes.length === 0) return 'none given';
  const shown = codes.filter((code) => CODE.test(code));
  const hidden = codes.length - shown.length;
  if (hidden === 0) return shown.join(', ');
  return shown.length ? `${shown.join(', ')} and ${hidden} more not shown` : `${hidden} not shown`;
}

function guardLink(appUrl: string | undefined): string {
  const base = appUrl?.trim().replace(/\/+$/, '');
  return base && /^https?:\/\/[^\s]+$/i.test(base) && URL.canParse(base) ? `${base}/guard` : '/guard';
}

export function heldMessage(entry: AuditRow, appUrl?: string): string {
  return [
    `Payment guard: ${heldAction(entry)} is waiting for approval.`,
    `Customer: ${sanitized(maskEmail(entry.task.mandate.customerEmail))}.`,
    `Reasons: ${reasonsOf(entry.decision.violations.map((v) => v.code))}.`,
    `Audit entry #${sanitized(entry.id)}.`,
    `Approve or reject it on ${guardLink(appUrl)}`,
  ].join('\n');
}

// An error as text with every secret (a token, a key, a URL that carries one) replaced by `label`.
export function withoutSecrets(error: unknown, secrets: string[], label: string): string {
  const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  return secrets.filter(Boolean).reduce((text, secret) => text.split(secret).join(label), message);
}
