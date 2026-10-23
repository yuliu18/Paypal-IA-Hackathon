import { describe, expect, it } from 'vitest';
import type { AuditRow } from '../ports';
import { heldMessage } from './held-message';

const held = (codes: string[]): AuditRow => ({
  id: '7',
  at: '2026-10-21T10:00:00.000Z',
  tool: 'create_refund',
  args: { capture_id: 'CAP-1', amount: { value: '120.00', currency_code: 'USD' } },
  task: { mandate: { customerEmail: 'ana@example.com' }, instructions: '', untrustedInput: '' },
  decision: { verdict: 'hold', violations: codes.map((code) => ({ code, message: 'm' })) },
  outcome: 'held',
});

describe('heldMessage', () => {
  it('says how many reason codes it left out, instead of reading as if there were none', () => {
    const text = heldMessage(held(['APPROVAL_REQUIRED', '<@everyone> click', 'bad code']));
    expect(text).toContain('Reasons: APPROVAL_REQUIRED and 2 more not shown.');
    expect(text).not.toContain('@everyone');
  });

  it('says so when every code was left out', () => {
    expect(heldMessage(held(['<@everyone>']))).toContain('Reasons: 1 not shown.');
  });

  it('says none given only when there were no codes at all', () => {
    expect(heldMessage(held([]))).toContain('Reasons: none given.');
  });
});

describe('heldMessage by tool', () => {
  it('describes a held refund by its amount, as before', () => {
    expect(heldMessage(held(['APPROVAL_REQUIRED'])).split('\n')[0]).toBe('Payment guard: a refund of 120.00 USD is waiting for approval.');
  });

  it('describes a held cancellation by its subscription id', () => {
    const entry: AuditRow = { ...held(['INTENT_UNCERTAIN']), tool: 'cancel_subscription', args: { subscription_id: 'I-SUB1', payload: { reason: 'Too expensive' } } };
    const lines = heldMessage(entry).split('\n');
    expect(lines[0]).toBe('Payment guard: a subscription cancellation (I-SUB1) is waiting for approval.');
    expect(lines[2]).toBe('Reasons: INTENT_UNCERTAIN.');
    expect(heldMessage(entry)).not.toContain('Too expensive');
  });

  it('quotes only a plain subscription id, so nothing in it can become a link or mention', () => {
    const entry: AuditRow = { ...held([]), tool: 'cancel_subscription', args: { subscription_id: '<@everyone> https://evil.example/x' } };
    expect(heldMessage(entry).split('\n')[0]).toBe('Payment guard: a subscription cancellation (unreadable id) is waiting for approval.');
    expect(heldMessage(entry)).not.toContain('everyone');
  });
});
