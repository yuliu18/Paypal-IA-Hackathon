import { AccountLockout } from './account-lockout';
import { describe, expect, it, vi } from 'vitest';
import { FailedAttempts } from '@/lib/auth/failed-attempts';
import { CodeThrottle, requestResetCode, resetOwnerPassword, type ForgotDeps, type ResetDeps } from './recovery';

const OWNER = 'owner@shop.example';
const minutes = (n: number) => n * 60_000;

const forgotDeps = (overrides: Partial<ForgotDeps> = {}): ForgotDeps => ({
  ownerEmail: async () => OWNER,
  sendCode: vi.fn(async () => undefined),
  requests: new FailedAttempts({ maxFailures: 5, windowMs: minutes(15) }),
  throttle: new CodeThrottle(minutes(1)),
  ...overrides,
});

describe('requestResetCode', () => {
  it("emails a code only to the owner's address, and answers the same for any address", async () => {
    const deps = forgotDeps();
    const forOwner = await requestResetCode({ email: OWNER, client: 'a', now: 0 }, deps);
    const forStranger = await requestResetCode({ email: 'someone@else.example', client: 'b', now: 0 }, deps);
    expect(forOwner).toBe('sent');
    expect(forStranger).toBe('sent');
    expect(deps.sendCode).toHaveBeenCalledTimes(1);
    expect(deps.sendCode).toHaveBeenCalledWith(OWNER);
  });

  it("matches the owner's address whatever its case or surrounding spaces", async () => {
    const deps = forgotDeps();
    expect(await requestResetCode({ email: '  Owner@Shop.Example ', client: 'a', now: 0 }, deps)).toBe('sent');
    expect(deps.sendCode).toHaveBeenCalledWith(OWNER);
  });

  it('answers the same when sending the code fails, so a failure does not reveal the owner', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const deps = forgotDeps({ sendCode: vi.fn(async () => Promise.reject(new Error('smtp down'))) });
    expect(await requestResetCode({ email: OWNER, client: 'a', now: 0 }, deps)).toBe('sent');
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(log).toHaveBeenCalled();
    log.mockRestore();
  });

  it('does not wait for the email to go out, so the answer takes as long for any address', async () => {
    let release: () => void = () => undefined;
    const deps = forgotDeps({ sendCode: vi.fn(() => new Promise<void>((resolve) => (release = resolve))) });
    expect(await requestResetCode({ email: OWNER, client: 'a', now: 0 }, deps)).toBe('sent');
    release();
  });

  it('sends no more than one code a minute to the owner', async () => {
    const deps = forgotDeps();
    await requestResetCode({ email: OWNER, client: 'a', now: 0 }, deps);
    expect(await requestResetCode({ email: OWNER, client: 'b', now: 59_000 }, deps)).toBe('sent');
    expect(deps.sendCode).toHaveBeenCalledTimes(1);
    await requestResetCode({ email: OWNER, client: 'c', now: 60_000 }, deps);
    expect(deps.sendCode).toHaveBeenCalledTimes(2);
  });

  it('lets a client ask 5 times in 15 minutes, for any address, then refuses until the window ends', async () => {
    const deps = forgotDeps();
    for (let i = 0; i < 5; i++) expect(await requestResetCode({ email: `x${i}@else.example`, client: 'a', now: i }, deps)).toBe('sent');
    expect(await requestResetCode({ email: OWNER, client: 'a', now: 10 }, deps)).toBe('tooMany');
    expect(deps.sendCode).not.toHaveBeenCalled();
    expect(await requestResetCode({ email: OWNER, client: 'other', now: 10 }, deps)).toBe('sent');
    expect(await requestResetCode({ email: OWNER, client: 'a', now: minutes(15) + 4 }, deps)).toBe('sent');
  });

  it('refuses something that is not an email address, for any address alike', async () => {
    const deps = forgotDeps();
    expect(await requestResetCode({ email: 'owner', client: 'a', now: 0 }, deps)).toBe('email');
    expect(deps.sendCode).not.toHaveBeenCalled();
  });

  it('says the service is unavailable when the owner cannot be looked up, before looking at the address', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const deps = forgotDeps({ ownerEmail: async () => Promise.reject(new Error('db down')) });
    expect(await requestResetCode({ email: OWNER, client: 'a', now: 0 }, deps)).toBe('unavailable');
    expect(await requestResetCode({ email: 'someone@else.example', client: 'b', now: 0 }, deps)).toBe('unavailable');
    log.mockRestore();
  });

  it('sends nothing while the installation has no owner', async () => {
    const deps = forgotDeps({ ownerEmail: async () => null });
    expect(await requestResetCode({ email: OWNER, client: 'a', now: 0 }, deps)).toBe('sent');
    expect(deps.sendCode).not.toHaveBeenCalled();
  });
});

const GOOD = 'Guard-the-gate-1';
const resetDeps = (overrides: Partial<ResetDeps> = {}): ResetDeps => ({
  ownerEmail: async () => OWNER,
  resetPassword: vi.fn(async () => 'done' as const),
  signOutEverywhere: vi.fn(async () => undefined),
  failures: new FailedAttempts({ maxFailures: 10, windowMs: minutes(15) }),
  accounts: new AccountLockout({ freeFailures: 5, baseMs: minutes(1), maxMs: minutes(60), resetAfterMs: minutes(24 * 60) }),
  otherAccounts: new AccountLockout({ freeFailures: 5, baseMs: minutes(1), maxMs: minutes(60), resetAfterMs: minutes(24 * 60), keepActive: false }),
  ...overrides,
});
const input = (overrides: Partial<Parameters<typeof resetOwnerPassword>[0]> = {}) => ({ email: OWNER, code: '123456', password: GOOD, confirm: GOOD, client: 'a', now: 0, ...overrides });

describe('resetOwnerPassword', () => {
  it("changes the owner's password with the emailed code and signs out every session", async () => {
    const deps = resetDeps();
    expect(await resetOwnerPassword(input({ email: ' Owner@Shop.Example ' }), deps)).toBe('done');
    expect(deps.resetPassword).toHaveBeenCalledWith({ email: OWNER, code: '123456', password: GOOD });
    expect(deps.signOutEverywhere).toHaveBeenCalledWith({ email: OWNER, password: GOOD });
  });

  it('applies the same strong-password rule as the owner set-up', async () => {
    const deps = resetDeps();
    for (const weak of ['short', 'nouppercase123', 'ALLUPPERCASE123', 'NoDigitsAtAllHere', `Aa1${'x'.repeat(126)}`]) {
      expect(await resetOwnerPassword(input({ password: weak, confirm: weak }), deps)).toBe('weak');
    }
    expect(deps.resetPassword).not.toHaveBeenCalled();
  });

  it('refuses two different passwords and a malformed address', async () => {
    const deps = resetDeps();
    expect(await resetOwnerPassword(input({ confirm: `${GOOD}x` }), deps)).toBe('mismatch');
    expect(await resetOwnerPassword(input({ email: 'owner' }), deps)).toBe('email');
    expect(await resetOwnerPassword(input({ code: '  ' }), deps)).toBe('invalidCode');
    expect(deps.resetPassword).not.toHaveBeenCalled();
  });

  it("resets only the owner's password: another address gets the wrong-code answer and counts as a failure", async () => {
    const deps = resetDeps();
    expect(await resetOwnerPassword(input({ email: 'someone@else.example' }), deps)).toBe('invalidCode');
    expect(deps.resetPassword).not.toHaveBeenCalled();
    expect(await resetOwnerPassword(input({ email: 'someone@else.example' }), resetDeps({ ownerEmail: async () => null }))).toBe('invalidCode');
  });

  it('sends a wrong or expired code back with an error, counted in the sign-in lockout', async () => {
    const failures = new FailedAttempts({ maxFailures: 10, windowMs: minutes(15) });
    // A lenient account lockout, so this pins the per-client one.
    const accounts = new AccountLockout({ freeFailures: 1000, baseMs: 1, maxMs: 1, resetAfterMs: 1 });
    const deps = resetDeps({ failures, accounts, resetPassword: vi.fn(async () => 'invalidCode' as const) });
    for (let i = 0; i < 10; i++) expect(await resetOwnerPassword(input({ now: i }), deps)).toBe('invalidCode');
    expect(deps.signOutEverywhere).not.toHaveBeenCalled();
    expect(await resetOwnerPassword(input({ now: 20 }), deps)).toBe('locked');
    expect(deps.resetPassword).toHaveBeenCalledTimes(10);
  });

  it('does not count Neon Auth being down as a wrong code', async () => {
    const failures = new FailedAttempts({ maxFailures: 1, windowMs: minutes(15) });
    const deps = resetDeps({ failures, resetPassword: vi.fn(async () => 'unavailable' as const) });
    expect(await resetOwnerPassword(input(), deps)).toBe('unavailable');
    expect(failures.retryAfterMs('a', 1)).toBe(0);
  });

  it('still reports the change when signing the other sessions out fails', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const deps = resetDeps({ signOutEverywhere: vi.fn(async () => Promise.reject(new Error('down'))) });
    expect(await resetOwnerPassword(input(), deps)).toBe('done');
    expect(log).toHaveBeenCalled();
    log.mockRestore();
  });

  it('says unavailable when the owner cannot be looked up', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const deps = resetDeps({ ownerEmail: async () => Promise.reject(new Error('db down')) });
    expect(await resetOwnerPassword(input(), deps)).toBe('unavailable');
    log.mockRestore();
  });
});

describe('resetOwnerPassword against a code guessed from many clients', () => {
  it('locks the account after 5 wrong codes, whatever client each claims, and stops asking Neon Auth', async () => {
    const resetPassword = vi.fn(async () => 'invalidCode' as const);
    const deps = resetDeps({ resetPassword });
    for (let i = 0; i < 5; i++) expect(await resetOwnerPassword(input({ client: `forged-${i}` }), deps)).toBe('invalidCode');
    expect(await resetOwnerPassword(input({ client: 'forged-new' }), deps)).toBe('locked');
    expect(resetPassword).toHaveBeenCalledTimes(5);
  });

  it('lets at most 5 codes reach Neon Auth when 200 arrive at once', async () => {
    const resetPassword = vi.fn(() => new Promise<'invalidCode'>((resolve) => setTimeout(() => resolve('invalidCode'), 5)));
    const deps = resetDeps({ resetPassword });
    const outcomes = await Promise.all(Array.from({ length: 200 }, (_, i) => resetOwnerPassword(input({ client: `c${i}` }), deps)));
    expect(resetPassword).toHaveBeenCalledTimes(5);
    expect(outcomes.filter((o) => o === 'locked')).toHaveLength(195);
  });

  it('never tracks other addresses, so junk ones cannot push the owner out of the count', async () => {
    const deps = resetDeps({ resetPassword: vi.fn(async () => 'invalidCode' as const) });
    for (let i = 0; i < 5; i++) await resetOwnerPassword(input({ client: `o${i}` }), deps);
    for (let i = 0; i < 50; i++) expect(await resetOwnerPassword(input({ email: `junk${i}@x.example`, client: `j${i}` }), deps)).toBe('invalidCode');
    expect(deps.accounts.retryAfterMs(`junk0@x.example`, 0)).toBe(0);
    expect(await resetOwnerPassword(input({ client: 'o-new' }), deps)).toBe('locked');
  });

  it('answers any other address the same way, so "locked" never reveals the owner', async () => {
    const deps = resetDeps();
    const answers = [];
    for (let i = 0; i < 6; i++) answers.push(await resetOwnerPassword(input({ email: 'someone@x.example', client: `s${i}` }), deps));
    expect(answers).toEqual(['invalidCode', 'invalidCode', 'invalidCode', 'invalidCode', 'invalidCode', 'locked']);
    expect(deps.resetPassword).not.toHaveBeenCalled();
  });

  it('starts the account count over once the password is reset', async () => {
    const deps = resetDeps();
    for (let i = 0; i < 4; i++) deps.accounts.recordFailure(OWNER, 0);
    expect(await resetOwnerPassword(input(), deps)).toBe('done');
    deps.accounts.recordFailure(OWNER, 0);
    expect(deps.accounts.retryAfterMs(OWNER, 0)).toBe(0);
  });
});

describe('CodeThrottle', () => {
  it('allows one code per address per interval and forgets old addresses', () => {
    const throttle = new CodeThrottle(1000, 2);
    expect(throttle.take('a', 0)).toBe(true);
    expect(throttle.take('a', 999)).toBe(false);
    expect(throttle.take('a', 1000)).toBe(true);
    expect(throttle.take('b', 1000)).toBe(true);
    expect(throttle.take('c', 1000)).toBe(true);
    expect(throttle.take('a', 1001)).toBe(true);
  });
});
