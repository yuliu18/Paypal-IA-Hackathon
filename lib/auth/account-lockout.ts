// Failed sign-ins counted per account (the email tried), whatever client they claim to come from:
// the per-client lockout (lib/demo-auth.ts FailedAttempts) keys on headers a caller can forge, so
// on its own it can be dodged by changing them on every try. After `freeFailures` failures in a row
// the account is locked, for `baseMs`, then twice as long with every further failure, up to
// `maxMs`. A success, or `resetAfterMs` with no failure, starts the count over. In memory, per
// server process, like the other limits.
//
// Callers reserve an attempt with begin() before asking the auth service and settle it with end(),
// so attempts sent at the same moment can't all slip in before the first failure is counted: only
// as many run at once as failures remain before the lock (one at a time once it has locked).

type Entry = { streak: number; lastFailure: number; lockedUntil: number; pending: number };
export type AttemptOutcome = 'failure' | 'success' | 'neutral';

export class AccountLockout {
  private readonly accounts = new Map<string, Entry>();
  private readonly freeFailures: number;
  private readonly baseMs: number;
  private readonly maxMs: number;
  private readonly resetAfterMs: number;
  private readonly maxAccounts: number;
  private readonly keepActive: boolean;

  // `keepActive: false` lets a full map drop even locked accounts, oldest first: for counts that only
  // mirror answers and protect nothing, which then can't grow without bound.
  constructor({ freeFailures, baseMs, maxMs, resetAfterMs, maxAccounts = 10_000, keepActive = true }: { freeFailures: number; baseMs: number; maxMs: number; resetAfterMs: number; maxAccounts?: number; keepActive?: boolean }) {
    this.keepActive = keepActive;
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

  // Reserves one attempt; false when the account is locked or enough attempts are already running.
  begin(account: string, now: number): boolean {
    const entry = this.entry(key(account), now);
    if (entry.lockedUntil > now) return false;
    const streak = this.liveStreak(entry, now);
    if (entry.pending >= Math.max(1, this.freeFailures - streak)) return false;
    entry.pending += 1;
    return true;
  }

  // Settles an attempt begin() reserved: a wrong password or code, the right one, or no answer
  // about it at all (the service was down), which frees the slot without counting.
  end(account: string, outcome: AttemptOutcome, now: number) {
    const id = key(account);
    const entry = this.accounts.get(id);
    if (entry) entry.pending = Math.max(0, entry.pending - 1);
    if (outcome === 'failure') this.recordFailure(account, now);
    else if (outcome === 'success') this.recordSuccess(account);
  }

  recordFailure(account: string, now: number) {
    const entry = this.entry(key(account), now);
    entry.streak = this.liveStreak(entry, now) + 1;
    entry.lastFailure = now;
    const over = entry.streak - this.freeFailures;
    // 2 ** over overflows to Infinity long after the cap, so Math.min keeps it at maxMs.
    entry.lockedUntil = over >= 0 ? now + Math.min(this.baseMs * 2 ** over, this.maxMs) : 0;
  }

  recordSuccess(account: string) {
    const id = key(account);
    const entry = this.accounts.get(id);
    if (entry && entry.pending > 0) Object.assign(entry, { streak: 0, lastFailure: 0, lockedUntil: 0 });
    else this.accounts.delete(id);
  }

  private liveStreak(entry: Entry, now: number): number {
    return now - entry.lastFailure < this.resetAfterMs ? entry.streak : 0;
  }

  // The account's entry, created when missing. A full map first drops accounts with nothing to
  // remember (no attempt running, not locked, no failure within resetAfterMs); it never drops one
  // that is, so flooding it with other accounts can't wipe a lock.
  private entry(id: string, now: number): Entry {
    let entry = this.accounts.get(id);
    if (entry) return entry;
    if (this.accounts.size >= this.maxAccounts) {
      for (const [other, e] of this.accounts) {
        if (!this.keepActive || (e.pending === 0 && e.lockedUntil <= now && this.liveStreak(e, now) === 0)) this.accounts.delete(other);
        if (this.accounts.size < this.maxAccounts) break;
      }
    }
    entry = { streak: 0, lastFailure: 0, lockedUntil: 0, pending: 0 };
    this.accounts.set(id, entry);
    return entry;
  }
}

const key = (account: string) => account.trim().toLowerCase();
