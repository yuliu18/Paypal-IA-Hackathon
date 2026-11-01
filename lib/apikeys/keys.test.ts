import { createHash } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Db } from '@/lib/db/db';
import { migrate } from '@/lib/db/migrations';
import { createPgliteDb } from '@/lib/db/pglite';
import { createApiKeyStore, looksLikeApiKey, type ApiKeyStore } from './keys';

// API keys on an in-process Postgres, as when DATABASE_URL is set.

let db: Db;
let clock: number;
let store: ApiKeyStore;

beforeEach(async () => {
  db = await createPgliteDb();
  await migrate(db);
  clock = Date.parse('2026-11-01T10:00:00Z');
  store = createApiKeyStore(db, { now: () => new Date(clock) });
});

afterEach(() => db.close());

const created = async (name = 'Shop app') => {
  const result = await store.create(name);
  if (!result.ok) throw new Error(`create failed: ${result.reason}`);
  return result;
};

const rows = async () => (await db.query<{ id: string; name: string; hash: string; last4: string; last_used_at: Date | null; revoked_at: Date | null }>('SELECT * FROM guard.api_keys')).rows;

describe('creating a key', () => {
  it('returns the whole key once: pg_ and 32 random bytes in base64url', async () => {
    const { key, summary } = await created();
    expect(key).toMatch(/^pg_[A-Za-z0-9_-]{43}$/);
    expect(looksLikeApiKey(key)).toBe(true);
    expect(summary).toMatchObject({ name: 'Shop app', last4: key.slice(-4), createdAt: new Date(clock).toISOString(), lastUsedAt: null, revokedAt: null });
    expect((await created()).key).not.toBe(key);
  });

  it('stores only the SHA-256 hash and the last 4 characters, never the key', async () => {
    const { key } = await created();
    const [row] = await rows();
    expect(row.hash).toBe(createHash('sha256').update(key).digest('hex'));
    expect(row.last4).toBe(key.slice(-4));
    expect(JSON.stringify(row)).not.toContain(key);
  });

  it('needs a name of 1 to 60 characters, trimmed', async () => {
    expect(await store.create('   ')).toEqual({ ok: false, reason: 'invalid-name' });
    expect(await store.create('x'.repeat(61))).toEqual({ ok: false, reason: 'invalid-name' });
    expect((await created('  Checkout  ')).summary.name).toBe('Checkout');
    expect(await rows()).toHaveLength(1);
  });
});

describe('listing keys', () => {
  it('lists name, last 4, created, last used and revoked, newest first, without hashes', async () => {
    const first = await created('First');
    clock += 1000;
    const second = await created('Second');
    const listed = await store.list();
    expect(listed).toEqual({ ok: true, keys: [second.summary, first.summary] });
    expect(JSON.stringify(listed)).not.toContain(createHash('sha256').update(first.key).digest('hex'));
  });
});

describe('verifying a key', () => {
  it('accepts a created key and names it', async () => {
    const { key, summary } = await created();
    expect(await store.verify(key)).toEqual({ keyId: summary.id });
  });

  it('refuses a wrong, malformed or empty key', async () => {
    const { key } = await created();
    const other = `pg_${'A'.repeat(43)}`;
    expect(await store.verify(other)).toBeNull();
    expect(await store.verify(key.slice(0, -1))).toBeNull();
    expect(await store.verify(`${key}x`)).toBeNull();
    expect(await store.verify('')).toBeNull();
    expect(await store.verify(key.replace('pg_', 'sk_'))).toBeNull();
  });

  it('refuses a revoked key, and revoking twice or an unknown id says so', async () => {
    const { key, summary } = await created();
    expect(await store.revoke(summary.id)).toEqual({ ok: true });
    expect(await store.verify(key)).toBeNull();
    expect(await store.revoke(summary.id)).toEqual({ ok: false, reason: 'not-found' });
    expect(await store.revoke('00000000-0000-0000-0000-000000000000')).toEqual({ ok: false, reason: 'not-found' });
    expect(await store.revoke('not-a-uuid')).toEqual({ ok: false, reason: 'not-found' });
    const listed = await store.list();
    expect(listed.ok && listed.keys[0].revokedAt).toBe(new Date(clock).toISOString());
  });

  it('records when a key was last used, at most once a minute', async () => {
    const { key } = await created();
    const update = vi.spyOn(db, 'query');
    const updates = () => update.mock.calls.filter(([sql]) => sql.startsWith('UPDATE')).length;

    clock += 5_000;
    await store.verify(key);
    expect((await rows())[0].last_used_at?.toISOString()).toBe(new Date(clock).toISOString());
    const firstUse = clock;

    clock += 30_000;
    await store.verify(key);
    expect((await rows())[0].last_used_at?.toISOString()).toBe(new Date(firstUse).toISOString());
    expect(updates()).toBe(1);

    clock += 31_000;
    await store.verify(key);
    expect((await rows())[0].last_used_at?.toISOString()).toBe(new Date(clock).toISOString());
    expect(updates()).toBe(2);
  });

  it('fails closed when the database cannot be read', async () => {
    const { key } = await created();
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.spyOn(db, 'query').mockRejectedValue(new Error('unreachable'));
    expect(await store.verify(key)).toBeNull();
    expect(log).toHaveBeenCalled();
    expect(String(log.mock.calls[0])).not.toContain(key);
    log.mockRestore();
  });
});

describe('without a database (DATABASE_URL unset)', () => {
  const none = createApiKeyStore(undefined);

  it('reports every operation unavailable and never accepts a key', async () => {
    expect(none.available).toBe(false);
    expect(await none.create('Shop app')).toEqual({ ok: false, reason: 'unavailable' });
    expect(await none.list()).toEqual({ ok: false, reason: 'unavailable' });
    expect(await none.revoke('x')).toEqual({ ok: false, reason: 'unavailable' });
    expect(await none.verify(`pg_${'A'.repeat(43)}`)).toBeNull();
  });
});
