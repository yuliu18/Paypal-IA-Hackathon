// Per-client limits shared by the sign-in, recovery and agent endpoints: a count of failures per
// client address, and the address itself as the host's CDN reports it.

// Wrong passwords per client within a window that starts at its first failure; the failure that
// reaches the limit locks the client for a full window from then. Kept in memory: one server
// process, and a restart only gives a guesser a fresh window.
export class FailedAttempts {
  private readonly byClient = new Map<string, { count: number; since: number; lockedUntil?: number }>();
  private readonly maxFailures: number;
  private readonly windowMs: number;
  private readonly maxClients: number;

  constructor({ maxFailures, windowMs, maxClients = 10_000 }: { maxFailures: number; windowMs: number; maxClients?: number }) {
    this.maxFailures = maxFailures;
    this.windowMs = windowMs;
    this.maxClients = maxClients;
  }

  private current(client: string, now: number) {
    const entry = this.byClient.get(client);
    const expired = entry && (entry.lockedUntil === undefined ? now - entry.since >= this.windowMs : now >= entry.lockedUntil);
    if (expired) {
      this.byClient.delete(client);
      return undefined;
    }
    return entry;
  }

  // How long the client stays locked out; 0 when it may try.
  retryAfterMs(client: string, now: number): number {
    const entry = this.current(client, now);
    return entry?.lockedUntil === undefined ? 0 : entry.lockedUntil - now;
  }

  record(client: string, now: number) {
    let entry = this.current(client, now);
    if (!entry) {
      // Map keeps insertion order, so the first key is the oldest window.
      if (this.byClient.size >= this.maxClients) this.byClient.delete(this.byClient.keys().next().value!);
      entry = { count: 0, since: now };
      this.byClient.set(client, entry);
    }
    entry.count += 1;
    if (entry.count >= this.maxFailures) entry.lockedUntil ??= now + this.windowMs;
  }
}

// The address the CDN in front of the host saw, which a client can't set through it; then the first
// forwarded address. Requests with neither share one bucket.
export function clientAddress(headers: Headers): string {
  const forwarded = headers.get('x-forwarded-for')?.split(',')[0]?.trim();
  return headers.get('cf-connecting-ip') ?? headers.get('true-client-ip') ?? (forwarded || 'unknown');
}
