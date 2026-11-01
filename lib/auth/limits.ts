// The rate limits the public sign-in and recovery endpoints share, one set per server process
// (kept on globalThis across dev reloads).

import { FailedAttempts } from '@/lib/demo-auth';
import { CodeThrottle } from './recovery';

type Limits = { signInFailures: FailedAttempts; codeRequests: FailedAttempts; codeThrottle: CodeThrottle };

const globalForLimits = globalThis as typeof globalThis & { authLimits?: Limits };

export const limits: Limits = (globalForLimits.authLimits ??= {
  // 10 wrong passwords or reset codes lock that client out of signing in and resetting for 15 minutes.
  signInFailures: new FailedAttempts({ maxFailures: 10, windowMs: 15 * 60_000 }),
  // 5 reset-code requests per client per 15 minutes, whatever the address.
  codeRequests: new FailedAttempts({ maxFailures: 5, windowMs: 15 * 60_000 }),
  // At most one code a minute to the owner's address.
  codeThrottle: new CodeThrottle(60_000),
});
