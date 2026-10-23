import { describe, expect, it } from 'vitest';
import { TicketLimiter } from './ticket-limiter';

const limiter = (overrides: Partial<ConstructorParameters<typeof TicketLimiter>[0]> = {}) =>
  new TicketLimiter({ perClient: 3, windowMs: 60_000, inFlightPerClient: 2, inFlight: 3, ...overrides });

describe('TicketLimiter', () => {
  it('lets a client send up to its quota per window, then asks it to wait until the window ends', () => {
    const tickets = limiter();
    for (let i = 0; i < 3; i++) {
      const slot = tickets.acquire('1.1.1.1', 1_000);
      expect(slot.ok).toBe(true);
      if (slot.ok) slot.release();
    }
    expect(tickets.acquire('1.1.1.1', 11_000)).toEqual({ ok: false, reason: 'quota', retryAfterMs: 50_000 });
    expect(tickets.acquire('2.2.2.2', 11_000).ok).toBe(true);
    expect(tickets.acquire('1.1.1.1', 61_000).ok).toBe(true);
  });

  it('limits how many tickets one client runs at the same time', () => {
    const tickets = limiter({ perClient: 10 });
    const first = tickets.acquire('1.1.1.1', 0);
    expect(tickets.acquire('1.1.1.1', 0).ok).toBe(true);
    expect(tickets.acquire('1.1.1.1', 0)).toEqual({ ok: false, reason: 'busy', retryAfterMs: 5_000 });
    if (first.ok) first.release();
    expect(tickets.acquire('1.1.1.1', 0).ok).toBe(true);
  });

  it('limits tickets running at the same time across all clients, so many addresses cannot drain the key', () => {
    const tickets = limiter({ inFlightPerClient: 1 });
    const slots = ['a', 'b', 'c'].map((client) => tickets.acquire(client, 0));
    expect(slots.every((s) => s.ok)).toBe(true);
    expect(tickets.acquire('d', 0)).toEqual({ ok: false, reason: 'busy', retryAfterMs: 5_000 });
    if (slots[0].ok) slots[0].release();
    expect(tickets.acquire('d', 0).ok).toBe(true);
  });

  it('counts a rejected ticket against nothing and ignores a second release', () => {
    const tickets = limiter({ perClient: 2, inFlightPerClient: 1 });
    const slot = tickets.acquire('1.1.1.1', 0);
    expect(tickets.acquire('1.1.1.1', 0).ok).toBe(false);
    if (slot.ok) {
      slot.release();
      slot.release();
    }
    expect(tickets.acquire('1.1.1.1', 0).ok).toBe(true);
    expect(tickets.acquire('2.2.2.2', 0).ok).toBe(true);
    expect(tickets.acquire('3.3.3.3', 0).ok).toBe(true);
  });

  it('drops expired windows before forgetting a live one, so new addresses cannot reset a used-up quota', () => {
    const tickets = limiter({ perClient: 1, maxClients: 2 });
    const used = (client: string, now: number) => {
      const slot = tickets.acquire(client, now);
      if (slot.ok) slot.release();
    };
    used('old', 0);
    used('spent', 59_000);
    used('new', 61_000);
    expect(tickets.acquire('spent', 61_000).ok).toBe(false);
  });

  it('forgets the oldest client when it tracks too many, so memory stays bounded', () => {
    const tickets = limiter({ perClient: 1, maxClients: 2 });
    for (const client of ['a', 'b', 'c']) {
      const slot = tickets.acquire(client, 0);
      if (slot.ok) slot.release();
    }
    expect(tickets.acquire('a', 0).ok).toBe(true);
    expect(tickets.acquire('c', 0).ok).toBe(false);
  });
});
