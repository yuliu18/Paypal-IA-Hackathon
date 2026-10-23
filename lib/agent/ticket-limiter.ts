// Keeps a customer, or many customers at once, from burning the LLM key with tickets: a quota per
// client within a window, a cap on one client's tickets running at the same time, and a cap on
// all tickets running at the same time. It sits in front of the agent; the payment guard behind
// it protects the money, this protects the bill. Kept in memory: one server process, like
// lib/demo-auth.ts FailedAttempts.

// How long a client turned away for a busy agent should wait before trying again.
const BUSY_RETRY_MS = 5_000;

export type TicketSlot = { ok: true; release: () => void } | { ok: false; reason: 'quota' | 'busy'; retryAfterMs: number };

export class TicketLimiter {
  // Tickets per client within a window that starts at its first ticket.
  private readonly byClient = new Map<string, { count: number; since: number }>();
  private readonly running = new Map<string, number>();
  private runningTotal = 0;
  private readonly perClient: number;
  private readonly windowMs: number;
  private readonly inFlightPerClient: number;
  private readonly inFlight: number;
  private readonly maxClients: number;

  constructor({
    perClient,
    windowMs,
    inFlightPerClient,
    inFlight,
    maxClients = 10_000,
  }: {
    perClient: number;
    windowMs: number;
    inFlightPerClient: number;
    inFlight: number;
    maxClients?: number;
  }) {
    this.perClient = perClient;
    this.windowMs = windowMs;
    this.inFlightPerClient = inFlightPerClient;
    this.inFlight = inFlight;
    this.maxClients = maxClients;
  }

  private window(client: string, now: number) {
    const entry = this.byClient.get(client);
    if (entry && now - entry.since >= this.windowMs) {
      this.byClient.delete(client);
      return undefined;
    }
    return entry;
  }

  // A slot to run one ticket, released when it ends; a refused ticket uses up nothing.
  acquire(client: string, now: number): TicketSlot {
    const entry = this.window(client, now);
    if (entry && entry.count >= this.perClient) return { ok: false, reason: 'quota', retryAfterMs: entry.since + this.windowMs - now };
    if ((this.running.get(client) ?? 0) >= this.inFlightPerClient || this.runningTotal >= this.inFlight) {
      return { ok: false, reason: 'busy', retryAfterMs: BUSY_RETRY_MS };
    }

    if (entry) entry.count += 1;
    else {
      // Map keeps insertion order, so the first key is the oldest window.
      if (this.byClient.size >= this.maxClients) this.byClient.delete(this.byClient.keys().next().value!);
      this.byClient.set(client, { count: 1, since: now });
    }
    this.running.set(client, (this.running.get(client) ?? 0) + 1);
    this.runningTotal += 1;

    let released = false;
    return {
      ok: true,
      release: () => {
        if (released) return;
        released = true;
        const left = (this.running.get(client) ?? 1) - 1;
        if (left === 0) this.running.delete(client);
        else this.running.set(client, left);
        this.runningTotal -= 1;
      },
    };
  }
}
