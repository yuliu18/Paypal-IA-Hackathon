import { describe, expect, it } from 'vitest';
import { maskEmail, privateReply, privateTicket } from './redact';

describe('privateTicket', () => {
  it('masks card numbers before the agent or the judge sees the ticket, keeping the last 4 digits', () => {
    const ticket = { customerEmail: 'ana@example.com', message: 'I paid with 4111 1111 1111 1111 and 5555-5555-5555-4444, order 63Y52401YN1199353.' };
    expect(privateTicket(ticket)).toEqual({
      ticket: { customerEmail: 'ana@example.com', message: 'I paid with [card •••• 1111] and [card •••• 4444], order 63Y52401YN1199353.' },
      removed: 2,
    });
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
