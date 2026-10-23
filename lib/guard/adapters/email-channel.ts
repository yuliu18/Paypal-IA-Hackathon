// Picks how held-refund emails go out: through the shop's own SMTP server when it is fully set up
// (server, login and password), otherwise through Resend. Never both, so nobody gets the email twice,
// and a half-filled SMTP form never silences the email.

import type { HeldNotifier } from '../ports';
import { createEmailNotifier } from './email-notifier';
import { createSmtpNotifier, type SmtpNotifierOptions, type SmtpServer } from './smtp-notifier';

export type EmailChannelOptions = {
  smtp: SmtpServer;
  resendApiKey: string;
  from: string;
  to: string[];
  appUrl?: string;
  send?: SmtpNotifierOptions['send'];
  fetch?: typeof globalThis.fetch;
};

export function emailNotifier({ smtp, resendApiKey, from, to, appUrl, send, fetch }: EmailChannelOptions): HeldNotifier {
  const smtpReady = Boolean(smtp.host && smtp.user && smtp.password);
  return smtpReady ? createSmtpNotifier({ ...smtp, from, to, appUrl, send }) : createEmailNotifier({ apiKey: resendApiKey, from, to, appUrl, fetch });
}
