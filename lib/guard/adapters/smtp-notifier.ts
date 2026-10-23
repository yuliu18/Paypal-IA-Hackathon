// Emails the shop's contact addresses through any SMTP server (Gmail, Outlook, the hosting's own
// mail) when the guard holds a refund for approval: plain text only, the same message as every other
// channel (./held-message). The password only ever goes over TLS and never appears in the logs.

import { createTransport } from 'nodemailer';
import type { HeldNotifier } from '../ports';
import { heldMessage, withoutSecrets } from './held-message';

export type SmtpServer = { host: string; port: number; user: string; password: string };
export type SmtpMail = { from: string; to: string[]; subject: string; text: string };

export type SmtpNotifierOptions = SmtpServer & {
  // Blank: the login, which is what Gmail and most mail hosts accept as the sender anyway.
  from: string;
  to: string[];
  appUrl?: string;
  send?: (options: ReturnType<typeof smtpTransportOptions>, mail: SmtpMail) => Promise<void>;
  timeoutMs?: number;
};

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Port 465 speaks TLS from the start; every other port must upgrade with STARTTLS before the login,
// or nodemailer refuses to send, so the password never travels in clear.
export function smtpTransportOptions({ host, port, user, password }: SmtpServer, timeoutMs: number) {
  return {
    host,
    port,
    secure: port === 465,
    requireTLS: port !== 465,
    auth: { user, pass: password },
    connectionTimeout: timeoutMs,
    greetingTimeout: timeoutMs,
    socketTimeout: timeoutMs,
  };
}

async function sendWithNodemailer(options: ReturnType<typeof smtpTransportOptions>, mail: SmtpMail) {
  await createTransport(options).sendMail(mail);
}

export function createSmtpNotifier({ host, port, user, password, from, to, appUrl, send = sendWithNodemailer, timeoutMs = 5_000 }: SmtpNotifierOptions): HeldNotifier {
  return {
    async notifyHeld(entry) {
      const sender = from || (EMAIL.test(user) ? user : '');
      if (!host || !user || !password || !sender || !to.length) return;
      try {
        await send(smtpTransportOptions({ host, port, user, password }, timeoutMs), {
          from: sender,
          to,
          subject: 'Payment guard: a refund is waiting for approval',
          text: heldMessage(entry, appUrl),
        });
      } catch (error) {
        console.error(`Held-refund email failed: ${withoutSecrets(error, [password], '[password]')}`);
      }
    },
  };
}
