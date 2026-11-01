// API keys: the business's own app calls the agent API with `Authorization: Bearer <key>` instead
// of signing in (lib/auth/gate.ts decides where a key counts). A key is `pg_` and 32 random bytes in
// base64url, shown once when it is created; only its SHA-256 hash and last 4 characters are kept,
// in Postgres (<guard>.api_keys). Without DATABASE_URL there is nowhere to keep them: every
// operation reports "unavailable" and no key is ever accepted.

import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { schemaName, type Queryable } from '../db/db.ts';

export type ApiKeySummary = { id: string; name: string; last4: string; createdAt: string; lastUsedAt: string | null; revokedAt: string | null };

export type ApiKeyStore = {
  available: boolean;
  create(name: string): Promise<{ ok: true; key: string; summary: ApiKeySummary } | { ok: false; reason: 'unavailable' | 'invalid-name' }>;
  list(): Promise<{ ok: true; keys: ApiKeySummary[] } | { ok: false; reason: 'unavailable' }>;
  revoke(id: string): Promise<{ ok: true } | { ok: false; reason: 'unavailable' | 'not-found' }>;
  // The key's id when it is a live key; null otherwise, and whenever it can't be checked.
  verify(key: string): Promise<{ keyId: string } | null>;
};

export const MAX_NAME_LENGTH = 60;
const PREFIX = 'pg_';
const KEY_FORMAT = /^pg_[A-Za-z0-9_-]{43}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// "Last used" is written at most this often per key, so a busy app doesn't write on every call.
const LAST_USED_EVERY_MS = 60_000;

export const looksLikeApiKey = (key: string) => KEY_FORMAT.test(key);

const sha256 = (key: string) => createHash('sha256').update(key).digest('hex');

type Row = { id: string; name: string; last4: string; created_at: Date | string; last_used_at: Date | string | null; revoked_at: Date | string | null };

const iso = (value: Date | string | null) => (value === null ? null : new Date(value).toISOString());
const summary = (row: Row): ApiKeySummary => ({
  id: row.id,
  name: row.name,
  last4: row.last4,
  createdAt: iso(row.created_at)!,
  lastUsedAt: iso(row.last_used_at),
  revokedAt: iso(row.revoked_at),
});

const COLUMNS = 'id, name, last4, created_at, last_used_at, revoked_at';

export function createApiKeyStore(db: Queryable | undefined, { schema = 'guard', now = () => new Date() }: { schema?: string; now?: () => Date } = {}): ApiKeyStore {
  const s = schemaName(schema);
  if (!db) {
    return {
      available: false,
      create: async () => ({ ok: false, reason: 'unavailable' }),
      list: async () => ({ ok: false, reason: 'unavailable' }),
      revoke: async () => ({ ok: false, reason: 'unavailable' }),
      verify: async () => null,
    };
  }
  return {
    available: true,
    async create(rawName) {
      const name = rawName.trim();
      if (!name || name.length > MAX_NAME_LENGTH) return { ok: false, reason: 'invalid-name' };
      const key = PREFIX + randomBytes(32).toString('base64url');
      const { rows } = await db.query<Row>(
        `INSERT INTO ${s}.api_keys (id, name, hash, last4, created_at) VALUES ($1, $2, $3, $4, $5) RETURNING ${COLUMNS}`,
        [randomUUID(), name, sha256(key), key.slice(-4), now()],
      );
      return { ok: true, key, summary: summary(rows[0]) };
    },
    async list() {
      const { rows } = await db.query<Row>(`SELECT ${COLUMNS} FROM ${s}.api_keys ORDER BY created_at DESC, id`);
      return { ok: true, keys: rows.map(summary) };
    },
    async revoke(id) {
      if (!UUID.test(id)) return { ok: false, reason: 'not-found' };
      const { rows } = await db.query(`UPDATE ${s}.api_keys SET revoked_at = $2 WHERE id = $1 AND revoked_at IS NULL RETURNING id`, [id, now()]);
      return rows.length ? { ok: true } : { ok: false, reason: 'not-found' };
    },
    async verify(key) {
      if (!looksLikeApiKey(key)) return null;
      const hash = sha256(key);
      try {
        const { rows } = await db.query<{ id: string; hash: string; last_used_at: Date | string | null; revoked_at: Date | string | null }>(
          `SELECT id, hash, last_used_at, revoked_at FROM ${s}.api_keys WHERE hash = $1`,
          [hash],
        );
        const row = rows[0];
        // The lookup already matched; the constant-time comparison keeps the decision itself from
        // depending on how much of the hash matched.
        if (!row || row.revoked_at !== null || !timingSafeEqual(Buffer.from(row.hash, 'hex'), Buffer.from(hash, 'hex'))) return null;
        const at = now();
        if (row.last_used_at === null || at.getTime() - new Date(row.last_used_at).getTime() >= LAST_USED_EVERY_MS) {
          await db.query(`UPDATE ${s}.api_keys SET last_used_at = $2 WHERE id = $1 AND (last_used_at IS NULL OR last_used_at <= $3)`, [
            row.id,
            at,
            new Date(at.getTime() - LAST_USED_EVERY_MS),
          ]);
        }
        return { keyId: row.id };
      } catch (error) {
        // Never log the key; the error comes from the database driver.
        console.error('An API key could not be checked; refusing it', error);
        return null;
      }
    },
  };
}

// The installation's keys, in DATABASE_URL's database; "unavailable" when it is not set.
export async function apiKeys(env: NodeJS.ProcessEnv = process.env): Promise<ApiKeyStore> {
  const { getDb } = await import('../db/client.ts');
  return createApiKeyStore(getDb(env));
}
