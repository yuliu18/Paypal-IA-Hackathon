// Notifies a person through a chat webhook when the guard holds a refund for approval. The body
// carries both `text` (Slack incoming webhooks) and `content` (Discord), so either URL works.
// The message never quotes the ticket or any other text an outsider wrote: chat apps turn it into
// links and mentions. The webhook URL embeds a token, so it never appears in the logs.

import { maskEmail } from '../domain/redact';
import type { AuditRow, HeldNotifier } from '../ports';

export type WebhookNotifierOptions = {
  url: string;
  // Turns /guard into a link; without it the message names the path only.
  appUrl?: string;
  fetch?: typeof globalThis.fetch;
  timeoutMs?: number;
};

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

// Network errors can quote the URL or its host, and the URL carries the webhook's token.
function withoutUrl(error: unknown, url: string): string {
  const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  const host = URL.canParse(url) ? new URL(url).host : '';
  return [url, host].filter(Boolean).reduce((text, secret) => text.split(secret).join('[webhook]'), message);
}

export function createWebhookNotifier({ url, appUrl, fetch = globalThis.fetch, timeoutMs = 5_000 }: WebhookNotifierOptions): HeldNotifier {
  return {
    async notifyHeld(entry) {
      if (!url) return;
      const text = heldMessage(entry, appUrl);
      try {
        const response = await fetch(url, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ text, content: text }),
          signal: AbortSignal.timeout(timeoutMs),
        });
        if (!response.ok) console.error(`Held-refund notification failed: the webhook answered ${response.status}`);
      } catch (error) {
        console.error(`Held-refund notification failed: ${withoutUrl(error, url)}`);
      }
    },
  };
}
