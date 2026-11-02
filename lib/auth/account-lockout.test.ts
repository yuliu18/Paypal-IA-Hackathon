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

  it('keeps a bounded number of accounts, dropping the oldest', () => {
    const accounts = new AccountLockout({ freeFailures: 1, baseMs: MIN, maxMs: MIN, resetAfterMs: MIN, maxAccounts: 2 });
    accounts.recordFailure('a@x.example', 0);
    accounts.recordFailure('b@x.example', 0);
    accounts.recordFailure('c@x.example', 0);
    expect(accounts.retryAfterMs('a@x.example', 0)).toBe(0);
    expect(accounts.retryAfterMs('c@x.example', 0)).toBe(MIN);
  });
});
