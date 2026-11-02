// Failed sign-ins counted per account (the email tried), whatever client they claim to come from:
// the per-client lockout (lib/demo-auth.ts FailedAttempts) keys on headers a caller can forge, so
// on its own it can be dodged by changing them on every try. After `freeFailures` failures in a row
// the account is locked, for `baseMs`, then twice as long with every further failure, up to
// `maxMs`. A success, or `resetAfterMs` with no failure, starts the count over. In memory, per
// server process, like the other limits.

type Entry = { streak: number; lastFailure: number; lockedUntil: number };

export class AccountLockout {
  private readonly accounts = new Map<string, Entry>();
  private readonly freeFailures: number;
  private readonly baseMs: number;
  private readonly maxMs: number;
  private readonly resetAfterMs: number;
  private readonly maxAccounts: number;

  constructor({ freeFailures, baseMs, maxMs, resetAfterMs, maxAccounts = 10_000 }: { freeFailures: number; baseMs: number; maxMs: number; resetAfterMs: number; maxAccounts?: number }) {
    this.freeFailures = freeFailures;
    this.baseMs = baseMs;
    this.maxMs = maxMs;
    this.resetAfterMs = resetAfterMs;
    this.maxAccounts = maxAccounts;
  }

  // How long the account stays locked; 0 when it may try.
  retryAfterMs(account: string, now: number): number {
    const entry = this.accounts.get(key(account));
    return entry ? Math.max(0, entry.lockedUntil - now) : 0;
  }

  recordFailure(account: string, now: number) {
    const id = key(account);
    const previous = this.accounts.get(id);
    const streak = previous && now - previous.lastFailure < this.resetAfterMs ? previous.streak + 1 : 1;
    const over = streak - this.freeFailures;
    // 2 ** over overflows to Infinity long after the cap, so Math.min keeps it at maxMs.
    const lockedUntil = over >= 0 ? now + Math.min(this.baseMs * 2 ** over, this.maxMs) : 0;
    // Re-inserted so the Map's first key is always the account that failed longest ago.
    this.accounts.delete(id);
    if (this.accounts.size >= this.maxAccounts) this.accounts.delete(this.accounts.keys().next().value!);
    this.accounts.set(id, { streak, lastFailure: now, lockedUntil });
  }

  recordSuccess(account: string) {
    this.accounts.delete(key(account));
  }
}

const key = (account: string) => account.trim().toLowerCase();
