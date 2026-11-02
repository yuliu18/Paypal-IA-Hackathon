import { describe, expect, it } from 'vitest';
import { AccountLockout } from './account-lockout';

const MIN = 60_000;
const lockout = () => new AccountLockout({ freeFailures: 5, baseMs: MIN, maxMs: 60 * MIN, resetAfterMs: 24 * 60 * MIN });

describe('AccountLockout', () => {
  it('lets an account fail 4 times, then locks it for 1 minute at the 5th failure', () => {
    const accounts = lockout();
    for (let i = 0; i < 4; i++) accounts.recordFailure('owner@shop.example', 0);
    expect(accounts.retryAfterMs('owner@shop.example', 0)).toBe(0);
    accounts.recordFailure('owner@shop.example', 0);
    expect(accounts.retryAfterMs('owner@shop.example', 0)).toBe(MIN);
    expect(accounts.retryAfterMs('owner@shop.example', MIN)).toBe(0);
  });

  it('doubles the lock with every further failure, up to the cap', () => {
    const accounts = lockout();
    let now = 0;
    const waits: number[] = [];
    for (let i = 0; i < 12; i++) {
      accounts.recordFailure('owner@shop.example', now);
      const wait = accounts.retryAfterMs('owner@shop.example', now);
      if (wait > 0) waits.push(wait / MIN);
      now += wait;
    }
    expect(waits).toEqual([1, 2, 4, 8, 16, 32, 60, 60]);
  });

  it('counts the account whatever client the attempts claim to come from, and only that account', () => {
    const accounts = lockout();
    for (let i = 0; i < 5; i++) accounts.recordFailure('Owner@Shop.example ', 0);
    expect(accounts.retryAfterMs('owner@shop.example', 0)).toBe(MIN);
    expect(accounts.retryAfterMs('other@shop.example', 0)).toBe(0);
  });

  it('starts over after a success', () => {
    const accounts = lockout();
    for (let i = 0; i < 5; i++) accounts.recordFailure('owner@shop.example', 0);
    accounts.recordSuccess('owner@shop.example');
    expect(accounts.retryAfterMs('owner@shop.example', 0)).toBe(0);
    accounts.recordFailure('owner@shop.example', 0);
    expect(accounts.retryAfterMs('owner@shop.example', 0)).toBe(0);
  });

  it('forgets old failures after a quiet day', () => {
    const accounts = lockout();
    for (let i = 0; i < 7; i++) accounts.recordFailure('owner@shop.example', 0);
    const day = 24 * 60 * MIN;
    accounts.recordFailure('owner@shop.example', day);
    expect(accounts.retryAfterMs('owner@shop.example', day)).toBe(0);
  });

  it('keeps a bounded number of accounts, but never drops one that is locked or failing', () => {
    const accounts = new AccountLockout({ freeFailures: 1, baseMs: MIN, maxMs: MIN, resetAfterMs: MIN, maxAccounts: 2 });
    accounts.recordFailure('owner@x.example', 0);
    for (let i = 0; i < 100; i++) accounts.recordFailure(`junk${i}@x.example`, 0);
    expect(accounts.retryAfterMs('owner@x.example', 0)).toBe(MIN);
  });

  it('drops accounts whose failures are a day old first', () => {
    const accounts = new AccountLockout({ freeFailures: 5, baseMs: MIN, maxMs: MIN, resetAfterMs: MIN, maxAccounts: 2 });
    accounts.recordFailure('old@x.example', 0);
    accounts.recordFailure('kept@x.example', 2 * MIN);
    for (let i = 0; i < 4; i++) accounts.recordFailure('new@x.example', 2 * MIN);
    accounts.recordFailure('new@x.example', 2 * MIN);
    expect(accounts.retryAfterMs('new@x.example', 2 * MIN)).toBe(MIN);
  });

  it('lets only as many attempts run at once as failures remain before the lock', () => {
    const accounts = lockout();
    const started = Array.from({ length: 200 }, () => accounts.begin('owner@shop.example', 0));
    expect(started.filter(Boolean)).toHaveLength(5);
    for (let i = 0; i < 5; i++) accounts.end('owner@shop.example', 'failure', 0);
    expect(accounts.retryAfterMs('owner@shop.example', 0)).toBe(MIN);
    expect(accounts.begin('owner@shop.example', 0)).toBe(false);
  });

  it('after the lock, lets one attempt at a time through', () => {
    const accounts = lockout();
    for (let i = 0; i < 5; i++) accounts.recordFailure('owner@shop.example', 0);
    expect(accounts.begin('owner@shop.example', MIN)).toBe(true);
    expect(accounts.begin('owner@shop.example', MIN)).toBe(false);
    accounts.end('owner@shop.example', 'failure', MIN);
    expect(accounts.retryAfterMs('owner@shop.example', MIN)).toBe(2 * MIN);
  });

  it('frees the slot without counting a failure when the attempt was no guess (the service was down)', () => {
    const accounts = lockout();
    for (let i = 0; i < 4; i++) accounts.recordFailure('owner@shop.example', 0);
    expect(accounts.begin('owner@shop.example', 0)).toBe(true);
    accounts.end('owner@shop.example', 'neutral', 0);
    expect(accounts.retryAfterMs('owner@shop.example', 0)).toBe(0);
    expect(accounts.begin('owner@shop.example', 0)).toBe(true);
    accounts.end('owner@shop.example', 'success', 0);
    accounts.recordFailure('owner@shop.example', 0);
    expect(accounts.retryAfterMs('owner@shop.example', 0)).toBe(0);
  });
});
