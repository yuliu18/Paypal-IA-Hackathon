// Password recovery for the owner (app/login/forgot, app/login/reset): Neon Auth emails a code to
// the owner's address, and the code with a new password replaces the old one. Only the owner's
// address ever gets a code or a reset, and the "send me a code" answer is the same for any
// address, so these public pages never reveal which address is the owner's.

import type { FailedAttempts } from '@/lib/demo-auth';
import { looksLikeEmail, passwordProblems } from './password';

// At most one code per address per interval (the oldest addresses are forgotten past `maxEntries`).
export class CodeThrottle {
  private readonly lastSent = new Map<string, number>();
  constructor(
    private readonly intervalMs: number,
    private readonly maxEntries = 10_000,
  ) {}

  // True, and remembered, when a code may go to this address now.
  take(address: string, now: number): boolean {
    const last = this.lastSent.get(address);
    if (last !== undefined && now - last < this.intervalMs) return false;
    this.lastSent.delete(address);
    if (this.lastSent.size >= this.maxEntries) this.lastSent.delete(this.lastSent.keys().next().value!);
    this.lastSent.set(address, now);
    return true;
  }
}

const normalize = (email: string) => email.trim().toLowerCase();

export type ForgotDeps = {
  ownerEmail: () => Promise<string | null>;
  sendCode: (email: string) => Promise<void>;
  requests: FailedAttempts;
  throttle: CodeThrottle;
};

// `sent` is the answer for every well-formed address, the owner's or not.
export type ForgotOutcome = 'sent' | 'tooMany' | 'email' | 'unavailable';

export async function requestResetCode({ email, client, now }: { email: string; client: string; now: number }, deps: ForgotDeps): Promise<ForgotOutcome> {
  if (deps.requests.retryAfterMs(client, now) > 0) return 'tooMany';
  deps.requests.record(client, now);
  const address = normalize(email);
  if (!looksLikeEmail(address)) return 'email';

  let owner: string | null;
  try {
    owner = await deps.ownerEmail();
  } catch (error) {
    console.error('Owner lookup failed while sending a reset code', error);
    return 'unavailable';
  }
  if (owner !== null && address === normalize(owner) && deps.throttle.take(address, now)) {
    // Not awaited: the answer must take as long for a stranger's address as for the owner's, and
    // a failure to send must not change it.
    deps.sendCode(address).catch((error: unknown) => console.error('Sending the reset code failed', error));
  }
  return 'sent';
}

export type ResetDeps = {
  ownerEmail: () => Promise<string | null>;
  // 'invalidCode' for a wrong, used or expired code; 'unavailable' when Neon Auth can't be reached.
  resetPassword: (input: { email: string; code: string; password: string }) => Promise<'done' | 'invalidCode' | 'unavailable'>;
  signOutEverywhere: (input: { email: string; password: string }) => Promise<void>;
  // The sign-in lockout: wrong codes count with wrong passwords.
  failures: FailedAttempts;
};

export type ResetOutcome = 'done' | 'locked' | 'email' | 'mismatch' | 'weak' | 'invalidCode' | 'unavailable';

export async function resetOwnerPassword(
  { email, code, password, confirm, client, now }: { email: string; code: string; password: string; confirm: string; client: string; now: number },
  deps: ResetDeps,
): Promise<ResetOutcome> {
  if (deps.failures.retryAfterMs(client, now) > 0) return 'locked';
  const address = normalize(email);
  const otp = code.trim();
  if (!looksLikeEmail(address)) return 'email';
  if (password !== confirm) return 'mismatch';
  if (passwordProblems(password).length > 0) return 'weak';
  if (!otp) return 'invalidCode';

  let owner: string | null;
  try {
    owner = await deps.ownerEmail();
  } catch (error) {
    console.error('Owner lookup failed while resetting the password', error);
    return 'unavailable';
  }
  // Another address gets the wrong-code answer: the page must not tell it is not the owner's.
  const result = owner !== null && address === normalize(owner) ? await deps.resetPassword({ email: address, code: otp, password }) : 'invalidCode';
  if (result === 'unavailable') return 'unavailable';
  if (result === 'invalidCode') {
    deps.failures.record(client, now);
    return 'invalidCode';
  }
  try {
    await deps.signOutEverywhere({ email: address, password });
  } catch (error) {
    console.error('The password changed, but signing out the other sessions failed', error);
  }
  return 'done';
}
