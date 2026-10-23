// Notifies a person through a chat webhook when the guard holds a refund for approval. The body
// carries both `text` (Slack incoming webhooks) and `content` (Discord), so either URL works.
// The message (./held-message) never quotes the ticket. The webhook URL embeds a token, so it
// never appears in the logs.

import type { HeldNotifier } from '../ports';
import { heldMessage, withoutSecrets } from './held-message';

export type WebhookNotifierOptions = {
  url: string;
  // Turns /guard into a link; without it the message names the path only.
  appUrl?: string;
  fetch?: typeof globalThis.fetch;
  timeoutMs?: number;
};

// Network errors can quote the URL or its host, and the URL carries the webhook's token.
function withoutUrl(error: unknown, url: string): string {
  const host = URL.canParse(url) ? new URL(url).host : '';
  return withoutSecrets(error, [url, host], '[webhook]');
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
