// The rate limits the public sign-in and recovery endpoints share, one set per server process
// (kept on globalThis across dev reloads).

import { FailedAttempts } from '@/lib/demo-auth';
import { AccountLockout } from './account-lockout';
import { CodeThrottle } from './recovery';

type Limits = { signInFailures: FailedAttempts; accountFailures: AccountLockout; otherAccountFailures: AccountLockout; codeRequests: FailedAttempts; codeThrottle: CodeThrottle };

const globalForLimits = globalThis as typeof globalThis & { authLimits?: Limits };

export const limits: Limits = (globalForLimits.authLimits ??= {
  // 10 wrong passwords or reset codes lock that client out of signing in and resetting for 15 minutes.
  signInFailures: new FailedAttempts({ maxFailures: 10, windowMs: 15 * 60_000 }),
  // Wrong passwords or reset codes for the owner's account, from any client: from the 5th in a row, a lock of
  // 1 minute that doubles with every further failure (2, 4, 8… up to 60). A success, or a day with no
  // failure, starts over. Forged client headers can't dodge it, as they can the per-client lockout.
  accountFailures: new AccountLockout({ freeFailures: 5, baseMs: 60_000, maxMs: 60 * 60_000, resetAfterMs: 24 * 60 * 60_000 }),
  // The same answers for every other address, so "locked" never tells which address is the owner's.
  // It protects nothing, so flooding it with addresses only drops the oldest; it never touches the owner's.
  otherAccountFailures: new AccountLockout({ freeFailures: 5, baseMs: 60_000, maxMs: 60 * 60_000, resetAfterMs: 24 * 60 * 60_000, keepActive: false }),
  // 5 reset-code requests per client per 15 minutes, whatever the address.
  codeRequests: new FailedAttempts({ maxFailures: 5, windowMs: 15 * 60_000 }),
  // At most one code a minute to the owner's address.
  codeThrottle: new CodeThrottle(60_000),
});
