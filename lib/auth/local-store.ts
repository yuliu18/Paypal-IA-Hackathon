// Where the built-in owner account lives (lib/auth/config.ts `local` mode): with DATABASE_URL, the
// `auth` schema of that database (./pg-auth-store.ts, migration 3); without it, a SQLite file at
// AUTH_DB or data/auth.db (./sqlite-auth-store.ts). Both keep the same two tables, `owner` (one row
// at most) and `sessions` (only the SHA-256 hash of each session cookie), behind this interface.
// Relative imports carry .ts so plain Node (npm run owner:reset) can load this file.

import { getDb } from '../db/client.ts';
import { createPgAuthStore } from './pg-auth-store.ts';
import { createSqliteAuthStore } from './sqlite-auth-store.ts';

export type LocalOwner = { email: string; passwordHash: string };

export interface LocalAuthStore {
  // The owner, or null while the installation has none.
  owner(): Promise<LocalOwner | null>;
  // Creates the owner when there is none, atomically: false (and nothing changed) when one exists.
  createOwner(owner: LocalOwner, now: Date): Promise<boolean>;
  // Replaces the owner's password hash and ends every session in one step; false when there is no owner.
  setPassword(passwordHash: string, now: Date): Promise<boolean>;
  // Keeps a new session's hash until `expiresAt`; sessions already expired are dropped on the way.
  createSession(tokenHash: string, expiresAt: Date, now: Date): Promise<void>;
  // True for a live session of an existing owner; an expired one is refused and deleted.
  hasSession(tokenHash: string, now: Date): Promise<boolean>;
  deleteSession(tokenHash: string): Promise<void>;
  deleteAllSessions(): Promise<void>;
  close?(): void;
}

export const DEFAULT_AUTH_DB = 'data/auth.db';

const globalForStore = globalThis as typeof globalThis & { localAuthStore?: { where: string; store: LocalAuthStore } };

// The store for this environment, one per server process (kept on globalThis across dev reloads).
// Throws when it can't be opened; callers fail closed.
export function localAuthStore(env: NodeJS.ProcessEnv = process.env): LocalAuthStore {
  const db = getDb(env);
  const where = db ? `postgres:${env.DATABASE_URL}` : `sqlite:${env.AUTH_DB || DEFAULT_AUTH_DB}`;
  if (globalForStore.localAuthStore?.where !== where) {
    const previous = globalForStore.localAuthStore;
    globalForStore.localAuthStore = undefined;
    previous?.store.close?.();
    globalForStore.localAuthStore = { where, store: db ? createPgAuthStore(db) : createSqliteAuthStore(env.AUTH_DB || DEFAULT_AUTH_DB) };
  }
  return globalForStore.localAuthStore.store;
}
