import { describe, expect, it } from 'vitest';
import { clientAddress, FailedAttempts } from './failed-attempts';

const minute = 60_000;

describe('FailedAttempts', () => {
  it('locks a client out after 10 failures until the window ends', () => {
    const failures = new FailedAttempts({ maxFailures: 10, windowMs: 15 * minute });
    for (let i = 0; i < 10; i++) {
      expect(failures.retryAfterMs('1.1.1.1', i)).toBe(0);
      failures.record('1.1.1.1', i);
    }
    expect(failures.retryAfterMs('1.1.1.1', 10)).toBe(15 * minute - 1);
    expect(failures.retryAfterMs('1.1.1.1', 15 * minute + 9)).toBe(0);
  });

  it('locks for the whole window from the failure that reaches the limit, however spread out the failures were', () => {
    const failures = new FailedAttempts({ maxFailures: 10, windowMs: 15 * minute });
    for (let i = 0; i < 9; i++) failures.record('1.1.1.1', i);
    const tenth = 15 * minute - 1;
    failures.record('1.1.1.1', tenth);
    expect(failures.retryAfterMs('1.1.1.1', tenth)).toBe(15 * minute);
    expect(failures.retryAfterMs('1.1.1.1', tenth + 15 * minute - 1)).toBe(1);
    expect(failures.retryAfterMs('1.1.1.1', tenth + 15 * minute)).toBe(0);
  });

  it('does not lock other clients', () => {
    const failures = new FailedAttempts({ maxFailures: 2, windowMs: minute });
    failures.record('1.1.1.1', 0);
    failures.record('1.1.1.1', 1);
    expect(failures.retryAfterMs('1.1.1.1', 2)).toBeGreaterThan(0);
    expect(failures.retryAfterMs('2.2.2.2', 2)).toBe(0);
  });

  it('starts counting again once the window has passed', () => {
    const failures = new FailedAttempts({ maxFailures: 2, windowMs: minute });
    failures.record('1.1.1.1', 0);
    failures.record('1.1.1.1', minute);
    expect(failures.retryAfterMs('1.1.1.1', minute + 1)).toBe(0);
  });

  it('forgets the oldest clients beyond its capacity, so memory stays bounded', () => {
    const failures = new FailedAttempts({ maxFailures: 1, windowMs: minute, maxClients: 2 });
    for (const client of ['a', 'b', 'c']) failures.record(client, 0);
    expect(failures.retryAfterMs('a', 1)).toBe(0);
    expect(failures.retryAfterMs('c', 1)).toBeGreaterThan(0);
  });
});

describe('clientAddress', () => {
  const headers = (entries: Record<string, string>) => new Headers(entries);

  it('prefers the address set by the CDN in front of the host', () => {
    expect(clientAddress(headers({ 'cf-connecting-ip': '9.9.9.9', 'x-forwarded-for': '1.1.1.1' }))).toBe('9.9.9.9');
    expect(clientAddress(headers({ 'true-client-ip': '8.8.8.8', 'x-forwarded-for': '1.1.1.1' }))).toBe('8.8.8.8');
  });

  it('falls back to the first forwarded address, then to one shared bucket', () => {
    expect(clientAddress(headers({ 'x-forwarded-for': ' 1.1.1.1 , 10.0.0.1' }))).toBe('1.1.1.1');
    expect(clientAddress(headers({}))).toBe('unknown');
  });
});
