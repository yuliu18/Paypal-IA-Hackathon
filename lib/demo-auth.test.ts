import { describe, expect, it } from 'vitest';
import { clientAddress, demoAccess, FailedAttempts } from './demo-auth';

const basic = (user: string, password: string) => `Basic ${Buffer.from(`${user}:${password}`).toString('base64')}`;

describe('demoAccess', () => {
  it('lets in a request with the demo password, whatever the user name', () => {
    expect(demoAccess({ authorization: basic('judge', 's3cret'), password: 's3cret', production: true })).toBe('allow');
    expect(demoAccess({ authorization: basic('', 's3cret'), password: 's3cret', production: true })).toBe('allow');
  });

  it('accepts a password that contains a colon', () => {
    expect(demoAccess({ authorization: basic('judge', 'a:b'), password: 'a:b', production: true })).toBe('allow');
  });

  it('asks for credentials when they are missing or wrong', () => {
    expect(demoAccess({ authorization: null, password: 's3cret', production: true })).toBe('challenge');
    expect(demoAccess({ authorization: basic('judge', 'nope'), password: 's3cret', production: true })).toBe('challenge');
    expect(demoAccess({ authorization: 'Bearer s3cret', password: 's3cret', production: true })).toBe('challenge');
    expect(demoAccess({ authorization: 'Basic %%%not-base64', password: 's3cret', production: true })).toBe('challenge');
  });

  it('refuses everything in production when no password is configured', () => {
    expect(demoAccess({ authorization: basic('judge', ''), password: undefined, production: true })).toBe('unconfigured');
    expect(demoAccess({ authorization: null, password: '', production: true })).toBe('unconfigured');
  });

  it('stays open in local development when no password is configured', () => {
    expect(demoAccess({ authorization: null, password: undefined, production: false })).toBe('allow');
  });

  it('still requires the password in development once one is configured', () => {
    expect(demoAccess({ authorization: null, password: 's3cret', production: false })).toBe('challenge');
  });
});

describe('demoAccess with a failed-attempt limit', () => {
  const minute = 60_000;
  const limited = (failures: FailedAttempts, client: string, given: string | null, now: number) =>
    demoAccess({ authorization: given === null ? null : basic('judge', given), password: 's3cret', production: true, attempts: { failures, client, now } });

  it('locks a client out after 10 wrong passwords, even with the right one, until the window ends', () => {
    const failures = new FailedAttempts({ maxFailures: 10, windowMs: 15 * minute });
    for (let i = 0; i < 10; i++) expect(limited(failures, '1.1.1.1', 'nope', i)).toBe('challenge');
    expect(limited(failures, '1.1.1.1', 's3cret', 10)).toBe('locked');
    expect(failures.retryAfterMs('1.1.1.1', 10)).toBe(15 * minute - 10);
    expect(limited(failures, '1.1.1.1', 's3cret', 15 * minute)).toBe('allow');
  });

  it('does not lock other clients', () => {
    const failures = new FailedAttempts({ maxFailures: 2, windowMs: minute });
    limited(failures, '1.1.1.1', 'nope', 0);
    limited(failures, '1.1.1.1', 'nope', 1);
    expect(limited(failures, '1.1.1.1', 's3cret', 2)).toBe('locked');
    expect(limited(failures, '2.2.2.2', 's3cret', 2)).toBe('allow');
  });

  it('does not count a request without credentials, like the browser before the password prompt', () => {
    const failures = new FailedAttempts({ maxFailures: 2, windowMs: minute });
    for (let i = 0; i < 5; i++) expect(limited(failures, '1.1.1.1', null, i)).toBe('challenge');
    expect(limited(failures, '1.1.1.1', 's3cret', 5)).toBe('allow');
  });

  it('starts counting again once the window has passed', () => {
    const failures = new FailedAttempts({ maxFailures: 2, windowMs: minute });
    limited(failures, '1.1.1.1', 'nope', 0);
    limited(failures, '1.1.1.1', 'nope', minute);
    expect(limited(failures, '1.1.1.1', 's3cret', minute + 1)).toBe('allow');
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
