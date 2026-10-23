import { describe, expect, it } from 'vitest';
import type { AuditRow } from '../ports';
import { emailNotifier } from './email-channel';

const held: AuditRow = {
  id: '7',
  at: '2026-10-23T12:00:00Z',
  tool: 'create_refund',
  args: { capture_id: 'CAP-1', amount: { currency_code: 'USD', value: '120.00' } },
  task: { mandate: { customerEmail: 'ana@example.com' }, instructions: '', untrustedInput: '' },
  decision: { verdict: 'hold', violations: [{ code: 'APPROVAL_REQUIRED', message: 'over 100 USD' }] },
  outcome: 'held',
};

const SMTP = { host: 'smtp.gmail.com', port: 587, user: 'guard@shop.example', password: 'app-password' };

function channels() {
  const used: string[] = [];
  const send = async () => {
    used.push('smtp');
  };
  const fetch = (async () => {
    used.push('resend');
    return new Response('{}');
  }) as unknown as typeof globalThis.fetch;
  return { used, send, fetch };
}

const notify = (smtp: typeof SMTP, ports: ReturnType<typeof channels>) =>
  emailNotifier({ smtp, resendApiKey: 're_key', from: 'guard@shop.example', to: ['owner@shop.example'], send: ports.send, fetch: ports.fetch }).notifyHeld(held);

describe('emailNotifier', () => {
  it('sends through SMTP, and not Resend, when the server, login and password are all set', async () => {
    const ports = channels();
    await notify(SMTP, ports);
    expect(ports.used).toEqual(['smtp']);
  });

  it('falls back to Resend when SMTP is only half set up, so the email still goes out', async () => {
    for (const missing of [{ password: '' }, { user: '' }, { host: '' }]) {
      const ports = channels();
      await notify({ ...SMTP, ...missing }, ports);
      expect(ports.used).toEqual(['resend']);
    }
  });
});
