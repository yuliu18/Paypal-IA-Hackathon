// Sends a Telegram message through a bot when the guard holds a refund for approval. Plain text
// without parse_mode, so Telegram reads nothing in it as markup; the same message as every other
// channel (./held-message). The bot token is part of the URL, so neither appears in the logs.

import type { HeldNotifier } from '../ports';
import { heldMessage, withoutSecrets } from './held-message';

export type TelegramNotifierOptions = {
  botToken: string;
  // A user, group or channel id (-100… for groups and channels), or @channelname.
  chatId: string;
  appUrl?: string;
  fetch?: typeof globalThis.fetch;
  timeoutMs?: number;
};

// BotFather's shape, 123456789:AA…: nothing that could change the URL's path or query.
const TOKEN = /^\d+:[\w-]+$/;

export function createTelegramNotifier({ botToken, chatId, appUrl, fetch = globalThis.fetch, timeoutMs = 5_000 }: TelegramNotifierOptions): HeldNotifier {
  return {
    async notifyHeld(entry) {
      if (!botToken || !chatId) return;
      if (!TOKEN.test(botToken)) {
        console.error('Held-refund Telegram message not sent: the bot token is not in the 123456789:AA… form');
        return;
      }
      const url = `https://api.telegram.org/bot${botToken}/sendMessage`;
      try {
        const response = await fetch(url, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ chat_id: chatId, text: heldMessage(entry, appUrl) }),
          signal: AbortSignal.timeout(timeoutMs),
        });
        if (!response.ok) console.error(`Held-refund Telegram message failed: Telegram answered ${response.status}`);
      } catch (error) {
        console.error(`Held-refund Telegram message failed: ${withoutSecrets(error, [url, botToken], '[bot]')}`);
      }
    },
  };
}
