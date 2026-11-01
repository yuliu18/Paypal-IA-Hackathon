// The installation's one owner: the oldest account in Neon Auth's user table. Anyone could reach
// Neon Auth's own sign-up endpoint directly until sign-up is turned off there (README), so a later
// account never becomes the owner, whatever it signs in with.

import { query } from '@/lib/db/client';

export type OwnerLookup = { ownerId(): Promise<string | null>; forget(): void };

// The owner is remembered for `ttlMs`, so page views don't query the database; "no owner yet" is
// never remembered, so the set-up closes as soon as the owner exists. Errors propagate: callers
// fail closed.
export function createOwnerLookup(oldestUserId: () => Promise<string | null>, { ttlMs, now = Date.now }: { ttlMs: number; now?: () => number }): OwnerLookup {
  let cached: { id: string; until: number } | undefined;
  return {
    async ownerId() {
      if (cached && now() < cached.until) return cached.id;
      cached = undefined;
      const id = await oldestUserId();
      if (id !== null) cached = { id, until: now() + ttlMs };
      return id;
    },
    forget() {
      cached = undefined;
    },
  };
}

async function oldestUserId(): Promise<string | null> {
  const rows = await query<{ id: string }>('SELECT id FROM neon_auth."user" ORDER BY "createdAt" ASC, id ASC LIMIT 1');
  return rows[0]?.id ?? null;
}

// One per server process (kept on globalThis across dev reloads).
const globalForOwner = globalThis as typeof globalThis & { ownerLookup?: OwnerLookup };
export const owner: OwnerLookup = (globalForOwner.ownerLookup ??= createOwnerLookup(oldestUserId, { ttlMs: 5 * 60_000 }));

// The owner's email address, or null while there is no owner. Not remembered: it is read only by
// the password-recovery endpoints. Errors propagate.
export async function ownerEmail(): Promise<string | null> {
  const id = await owner.ownerId();
  if (id === null) return null;
  const rows = await query<{ email: string }>('SELECT email FROM neon_auth."user" WHERE id = $1', [id]);
  return rows[0]?.email ?? null;
}
