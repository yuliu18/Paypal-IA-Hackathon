import { describe, expect, it } from 'vitest';
import { maskEmail, maskPersonalData, privateReply, privateTicket } from './redact';

describe('privateTicket', () => {
  it('masks card numbers before the agent or the judge sees the ticket, keeping the last 4 digits', () => {
    const ticket = { customerEmail: 'ana@example.com', message: 'I paid with 4111 1111 1111 1111 and 5555-5555-5555-4444, order 63Y52401YN1199353.' };
    expect(privateTicket(ticket)).toEqual({
      ticket: { customerEmail: 'ana@example.com', message: 'I paid with [card •••• 1111] and [card •••• 4444], order 63Y52401YN1199353.' },
      removed: 2,
    });
  });

  it('finds a card number with more digits next to it: expiry, CVV, counts or ids', () => {
    const cases: [string, string][] = [
      ['My card 4111 1111 1111 1111 12/30 was charged twice', 'My card [card •••• 1111] 12/30 was charged twice'],
      ['card 4111 1111 1111 1111 123', 'card [card •••• 1111] 123'],
      ['paid with 4111111111111111 2 times', 'paid with [card •••• 1111] 2 times'],
      ['Order 12 4111 1111 1111 1111', 'Order 12 [card •••• 1111]'],
    ];
    for (const [message, masked] of cases) expect(privateTicket({ customerEmail: 'ana@example.com', message }).ticket.message).toBe(masked);
    expect(privateReply('Your card 4111 1111 1111 1111 12/30 is noted', 'ana@example.com').reply).toBe('Your card [card •••• 1111] 12/30 is noted');
  });

  it('finds a card number however its groups are separated: double spaces, dots, line breaks, no-break spaces', () => {
    for (const message of ['4111  1111  1111  1111', '4111 - 1111 - 1111 - 1111', '4111.1111.1111.1111', '4111\n1111\n1111\n1111', '4111\u00a01111\u00a01111\u00a01111']) {
      expect(privateTicket({ customerEmail: 'ana@example.com', message }).ticket.message).toBe('[card •••• 1111]');
    }
  });

  it('leaves a PayPal id alone even when its digits would pass as a card number', () => {
    const message = 'Order 5O4111111111111111 and capture 4111111111111111X';
    expect(privateTicket({ customerEmail: 'ana@example.com', message }).ticket.message).toBe(message);
    expect(privateReply(message, 'ana@example.com').reply).toBe(message);
  });

  it('does not cut a card number out of a longer unseparated number', () => {
    const message = 'Tracking 4111111111111111000017';
    expect(privateTicket({ customerEmail: 'ana@example.com', message }).ticket.message).toBe(message);
  });

  it('leaves numbers that are not card numbers alone: order ids, amounts, phone numbers', () => {
    const message = 'Order 12345678, 120.00 USD, call me on +34 612 345 678, tracking 1234567812345678.';
    expect(privateTicket({ customerEmail: 'ana@example.com', message })).toEqual({ ticket: { customerEmail: 'ana@example.com', message }, removed: 0 });
  });
});

describe('privateReply', () => {
  it("masks card numbers and every email except the ticket customer's", () => {
    const reply = 'Hi ANA@example.com, order of ben@example.com was paid with 4111111111111111; contact shop@business.example.com.';
    expect(privateReply(reply, 'ana@example.com')).toEqual({
      reply: 'Hi ANA@example.com, order of [email removed] was paid with [card •••• 1111]; contact [email removed].',
      removed: 3,
    });
  });

  it('masks whole emails with accents or apostrophes, and keeps such a customer address', () => {
    expect(privateReply('Write to bén@exämple.com', 'ana@example.com')).toEqual({ reply: 'Write to [email removed]', removed: 1 });
    expect(privateReply("Hi o'brien@example.com", "o'brien@example.com")).toEqual({ reply: "Hi o'brien@example.com", removed: 0 });
  });

  it("keeps the shop's own contact addresses", () => {
    expect(privateReply('Write to Support@shop.example.com or ben@example.com', 'ana@example.com', ['support@shop.example.com'])).toEqual({
      reply: 'Write to Support@shop.example.com or [email removed]',
      removed: 1,
    });
  });

  it('returns a reply with nothing personal unchanged', () => {
    expect(privateReply('Your refund of $49.99 is on its way.', 'ana@example.com')).toEqual({ reply: 'Your refund of $49.99 is on its way.', removed: 0 });
  });
});

describe('maskEmail', () => {
  it('keeps the first letter and the domain, so a person can still tell customers apart', () => {
    expect(maskEmail('ana@example.com')).toBe('a***@example.com');
    expect(maskEmail('not an email')).toBe('not an email');
  });
});

describe('maskPersonalData', () => {
  it('masks every email and card number in text shown on a screen', () => {
    expect(maskPersonalData('Order is not one of the ticket customer ana@example.com; card 4111111111111111')).toBe(
      'Order is not one of the ticket customer a***@example.com; card [card •••• 1111]',
    );
    expect(maskPersonalData('{"capture_id":"CAP-1","amount":{"value":"49.99"}}')).toBe('{"capture_id":"CAP-1","amount":{"value":"49.99"}}');
  });
});
