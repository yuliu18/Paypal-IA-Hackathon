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

  it('describes a held dispute acceptance by its dispute id, quoting only a plain id', () => {
    const entry: AuditRow = { ...held(['APPROVAL_REQUIRED']), tool: 'accept_dispute_claim', args: { dispute_id: 'PP-D-1', note: 'Item_not_delivered' } };
    expect(heldMessage(entry).split('\n')[0]).toBe('Payment guard: a dispute claim acceptance (PP-D-1), which refunds the disputed amount, is waiting for approval.');
    const hostile: AuditRow = { ...entry, args: { dispute_id: '<@everyone> https://evil.example/x' } };
    expect(heldMessage(hostile).split('\n')[0]).toBe('Payment guard: a dispute claim acceptance (unreadable id), which refunds the disputed amount, is waiting for approval.');
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

  it('describes a held invoice by its total, never its recipient or notes', () => {
    const args = {
      currency_code: 'USD',
      note: '<@everyone> pay at https://evil.example',
      primary_recipients: [{ billing_info: { email_address: 'ana@example.com' } }],
      items: [{ name: 'Mug', quantity: '2', unit_amount: { currency_code: 'USD', value: '60.00' } }],
    };
    const entry: AuditRow = { ...held(['APPROVAL_REQUIRED']), tool: 'create_invoice', args };
    expect(heldMessage(entry).split('\n')[0]).toBe('Payment guard: an invoice of 120.00 USD is waiting for approval.');
    expect(heldMessage(entry)).not.toContain('everyone');
    const unreadable: AuditRow = { ...entry, args: { ...args, items: [{ name: 'x', quantity: 'lots', unit_amount: { currency_code: 'USD', value: '1' } }] } };
    expect(heldMessage(unreadable).split('\n')[0]).toBe('Payment guard: an invoice of an unreadable amount is waiting for approval.');
  });

  it('describes a held invoice sending or reminder by its invoice id, quoting only a plain id', () => {
    const sending: AuditRow = { ...held(['INTENT_UNCERTAIN']), tool: 'send_invoice', args: { invoice_id: 'INV2-ABC1' } };
    expect(heldMessage(sending).split('\n')[0]).toBe('Payment guard: sending invoice INV2-ABC1 to the customer is waiting for approval.');
    const reminder: AuditRow = { ...sending, tool: 'send_invoice_reminder' };
    expect(heldMessage(reminder).split('\n')[0]).toBe('Payment guard: a reminder of invoice INV2-ABC1 is waiting for approval.');
    const hostile: AuditRow = { ...reminder, args: { invoice_id: '<@everyone> https://evil.example/x' } };
    expect(heldMessage(hostile).split('\n')[0]).toBe('Payment guard: a reminder of invoice (unreadable id) is waiting for approval.');
  });
});
