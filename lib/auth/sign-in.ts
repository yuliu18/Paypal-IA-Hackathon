// Signing the owner in, whoever keeps the account (Neon Auth or the app itself): the same limits
// either way (./limits.ts). A client with 10 failures in 15 minutes is locked out; the owner's
// address, from any client, is locked from its 5th failure in a row, for longer with each further
// one. Guesses at any other address are counted apart, with the same answers, so "locked" never
// tells which address is the owner's. An attempt is reserved before the password is checked, so
// guesses sent at the same moment can't all reach the check.

import type { AccountLockout } from './account-lockout';
import type { FailedAttempts } from './failed-attempts';

// What checking the password said: right (and signed in), wrong, right but not the owner's account,
// or no answer at all (the service or the store was down).
export type PasswordCheck = 'ok' | 'wrong' | 'notOwner' | 'unavailable';
export type SignInOutcome = 'ok' | 'invalid' | 'locked' | 'notOwner' | 'unavailable';

export type SignInDeps = {
  ownerEmail: () => Promise<string | null>;
  // Checks the password; `isOwner` says whether the address is the owner's.
  check: (isOwner: boolean) => Promise<PasswordCheck>;
  failures: FailedAttempts;
  accounts: AccountLockout;
  otherAccounts: AccountLockout;
  now?: () => number;
};

export async function signInOwner({ email, password, client }: { email: string; password: string; client: string }, deps: SignInDeps): Promise<SignInOutcome> {
  const now = deps.now ?? Date.now;
  if (deps.failures.retryAfterMs(client, now()) > 0) return 'locked';
  if (!email || !password) return 'invalid';

  let isOwner: boolean;
  try {
    const address = await deps.ownerEmail();
    isOwner = address !== null && address.trim().toLowerCase() === email;
  } catch (error) {
    console.error('Owner lookup failed while signing in', error);
    return 'unavailable';
  }
  const accounts = isOwner ? deps.accounts : deps.otherAccounts;
  if (!accounts.begin(email, now())) return 'locked';

  let checked: PasswordCheck;
  try {
    checked = await deps.check(isOwner);
  } catch (error) {
    console.error('Sign-in failed', error);
    checked = 'unavailable';
  }
  if (checked === 'wrong') {
    deps.failures.record(client, now());
    accounts.end(email, 'failure', now());
    return 'invalid';
  }
  if (checked === 'ok') {
    accounts.end(email, 'success', now());
    return 'ok';
  }
  accounts.end(email, 'neutral', now());
  return checked;
}
