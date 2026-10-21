// Shared-password gate for the deployed demo: the app can issue PayPal refunds and spend the LLM
// key, so nobody without the password may reach it. HTTP Basic auth, any user name.
// Without DEMO_PASSWORD it fails closed in production and stays open in local development.
// A client that sends too many wrong passwords is locked out for a while, so guessing is slow.

import { createHash, timingSafeEqual } from 'node:crypto';

export type DemoAccess = 'allow' | 'challenge' | 'unconfigured' | 'locked';

// Hashing first gives equal-length buffers, so the comparison takes the same time whatever the guess.
const sameSecret = (a: string, b: string) =>
  timingSafeEqual(createHash('sha256').update(a).digest(), createHash('sha256').update(b).digest());

function basicPassword(authorization: string | null): string | undefined {
  const [scheme, encoded] = authorization?.split(' ') ?? [];
  if (scheme !== 'Basic' || !encoded) return undefined;
  const decoded = Buffer.from(encoded, 'base64').toString('utf8');
  const colon = decoded.indexOf(':');
  return colon === -1 ? undefined : decoded.slice(colon + 1);
}

// Wrong passwords per client within a window that starts at its first failure. Kept in memory: one
// server process, and a restart only gives a guesser a fresh window.
export class FailedAttempts {
  private readonly byClient = new Map<string, { count: number; since: number }>();
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
    if (entry && now - entry.since >= this.windowMs) {
      this.byClient.delete(client);
      return undefined;
    }
    return entry;
  }

  // How long the client stays locked out; 0 when it may try.
  retryAfterMs(client: string, now: number): number {
    const entry = this.current(client, now);
    return entry && entry.count >= this.maxFailures ? entry.since + this.windowMs - now : 0;
  }

  record(client: string, now: number) {
    const entry = this.current(client, now);
    if (entry) {
      entry.count += 1;
      return;
    }
    // Map keeps insertion order, so the first key is the oldest window.
    if (this.byClient.size >= this.maxClients) this.byClient.delete(this.byClient.keys().next().value!);
    this.byClient.set(client, { count: 1, since: now });
  }
}

// The address the CDN in front of the host saw, which a client can't set through it; then the first
// forwarded address. Requests with neither share one bucket.
export function clientAddress(headers: Headers): string {
  const forwarded = headers.get('x-forwarded-for')?.split(',')[0]?.trim();
  return headers.get('cf-connecting-ip') ?? headers.get('true-client-ip') ?? (forwarded || 'unknown');
}

export function demoAccess({
  authorization,
  password,
  production,
  attempts,
}: {
  authorization: string | null;
  password: string | undefined;
  production: boolean;
  attempts?: { failures: FailedAttempts; client: string; now: number };
}): DemoAccess {
  if (!password) return production ? 'unconfigured' : 'allow';
  // A locked-out client is refused before its password is checked, so guessing teaches it nothing.
  if (attempts && attempts.failures.retryAfterMs(attempts.client, attempts.now) > 0) return 'locked';
  const given = basicPassword(authorization);
  if (given !== undefined && sameSecret(given, password)) return 'allow';
  // No credentials is the browser's first request before it shows the prompt, not a guess.
  if (given !== undefined) attempts?.failures.record(attempts.client, attempts.now);
  return 'challenge';
}
