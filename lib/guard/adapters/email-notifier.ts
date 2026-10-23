// Emails the shop's contact addresses through Resend's HTTP API when the guard holds a refund for
// approval: plain text only, the same message as every other channel (./held-message). The API key
// travels in a header and never appears in the logs.

import type { HeldNotifier } from '../ports';
import { heldMessage, withoutSecrets } from './held-message';

export type EmailNotifierOptions = {
  apiKey: string;
  // A sender on a domain verified in Resend; its test sender onboarding@resend.dev only delivers to
  // the Resend account owner's own address.
  from: string;
  to: string[];
  appUrl?: string;
  fetch?: typeof globalThis.fetch;
  timeoutMs?: number;
};

const RESEND_URL = 'https://api.resend.com/emails';

export function createEmailNotifier({ apiKey, from, to, appUrl, fetch = globalThis.fetch, timeoutMs = 5_000 }: EmailNotifierOptions): HeldNotifier {
  return {
    async notifyHeld(entry) {
      if (!apiKey || !from || !to.length) return;
      try {
        const response = await fetch(RESEND_URL, {
          method: 'POST',
          headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
          body: JSON.stringify({ from, to, subject: 'Payment guard: a refund is waiting for approval', text: heldMessage(entry, appUrl) }),
          signal: AbortSignal.timeout(timeoutMs),
        });
        if (!response.ok) console.error(`Held-refund email failed: Resend answered ${response.status}`);
      } catch (error) {
        console.error(`Held-refund email failed: ${withoutSecrets(error, [apiKey], '[key]')}`);
      }
    },
  };
}
