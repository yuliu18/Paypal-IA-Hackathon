import { mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Db } from '@/lib/db/db';
import { migrate } from '@/lib/db/migrations';
import { createPgliteDb } from '@/lib/db/pglite';
import type { LocalAuthStore } from './local-store';
import { createPgAuthStore } from './pg-auth-store';
import { createSqliteAuthStore } from './sqlite-auth-store';

// The same behaviour from both stores: Postgres (in-process PGlite, as with DATABASE_URL) and the
// SQLite file used without a database.

const scratch = mkdtempSync(join(tmpdir(), 'auth-store-'));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

type Backend = { name: string; open(): Promise<{ store: LocalAuthStore; rows(table: 'owner' | 'sessions'): Promise<Record<string, unknown>[]>; close(): Promise<void> }> };

let sqliteFiles = 0;
const BACKENDS: Backend[] = [
  {
    name: 'Postgres',
    async open() {
      const db: Db = await createPgliteDb();
      await migrate(db);
      return { store: createPgAuthStore(db), rows: async (table) => (await db.query(`SELECT * FROM auth.${table}`)).rows, close: () => db.close() };
    },
  },
  {
    name: 'SQLite',
    async open() {
      const path = join(scratch, `nested-${++sqliteFiles}`, 'auth.db');
      const store = createSqliteAuthStore(path);
      const reader = new DatabaseSync(path);
      return {
        store,
        rows: async (table) => reader.prepare(`SELECT * FROM ${table}`).all() as Record<string, unknown>[],
        close: async () => {
          reader.close();
          store.close?.();
        },
      };
    },
  },
];

const t0 = new Date('2026-11-02T10:00:00Z');
const later = (ms: number) => new Date(t0.getTime() + ms);
const owner = { email: 'owner@shop.example', passwordHash: 'scrypt$32768$8$1$c2FsdA==$aGFzaA==' };

describe.each(BACKENDS)('the owner account store on $name', (backend) => {
  let opened: Awaited<ReturnType<Backend['open']>>;
  let store: LocalAuthStore;
  beforeEach(async () => {
    opened = await backend.open();
    store = opened.store;
  });
  afterEach(() => opened.close());

  it('has no owner until one is created, then exactly that one', async () => {
    expect(await store.owner()).toBeNull();
    expect(await store.createOwner(owner, t0)).toBe(true);
    expect(await store.owner()).toEqual(owner);
    expect(await opened.rows('owner')).toHaveLength(1);
  });

  it('creates the owner once: a second set-up, even at the same moment, is refused and changes nothing', async () => {
    const results = await Promise.all([store.createOwner(owner, t0), store.createOwner({ email: 'other@x.example', passwordHash: 'scrypt$x' }, t0)]);
    expect(results.filter(Boolean)).toHaveLength(1);
    const kept = await store.owner();
    expect(await store.createOwner({ email: 'late@x.example', passwordHash: 'scrypt$y' }, later(1000))).toBe(false);
    expect(await store.owner()).toEqual(kept);
    expect(await opened.rows('owner')).toHaveLength(1);
  });

  it('keeps a session until it expires, then refuses it and deletes its row', async () => {
    await store.createOwner(owner, t0);
    await store.createSession('hash-a', later(60_000), t0);
    expect(await store.hasSession('hash-a', later(59_999))).toBe(true);
    expect(await store.hasSession('hash-b', later(1))).toBe(false);
    expect(await store.hasSession('hash-a', later(60_000))).toBe(false);
    expect(await opened.rows('sessions')).toEqual([]);
  });

  it('stores what it is given, the session hash, and drops expired sessions when a new one starts', async () => {
    await store.createOwner(owner, t0);
    await store.createSession('old', later(10), t0);
    await store.createSession('new', later(60_000), later(20));
    const rows = await opened.rows('sessions');
    expect(rows.map((r) => r.token_hash)).toEqual(['new']);
  });

  it('deletes one session, or every one', async () => {
    await store.createOwner(owner, t0);
    for (const hash of ['a', 'b', 'c']) await store.createSession(hash, later(60_000), t0);
    await store.deleteSession('a');
    expect(await store.hasSession('a', t0)).toBe(false);
    expect(await store.hasSession('b', t0)).toBe(true);
    await store.deleteAllSessions();
    expect(await store.hasSession('b', t0)).toBe(false);
    expect(await opened.rows('sessions')).toEqual([]);
  });

  it('refuses a session while there is no owner', async () => {
    await store.createSession('orphan', later(60_000), t0);
    expect(await store.hasSession('orphan', t0)).toBe(false);
  });

  it('changes the password and ends every session in one step; with no owner it changes nothing', async () => {
    expect(await store.setPassword('scrypt$new', t0)).toBe(false);
    expect(await opened.rows('owner')).toEqual([]);
    await store.createOwner(owner, t0);
    await store.createSession('a', later(60_000), t0);
    expect(await store.setPassword('scrypt$new', later(5))).toBe(true);
    expect(await store.owner()).toEqual({ email: owner.email, passwordHash: 'scrypt$new' });
    expect(await store.hasSession('a', later(6))).toBe(false);
  });
});

describe('the SQLite owner account store', () => {
  it('creates its folder and keeps the file readable by the server user only', () => {
    const path = join(scratch, 'private', 'deep', 'auth.db');
    const store = createSqliteAuthStore(path);
    expect(statSync(path).mode & 0o777).toBe(0o600);
    store.close?.();
  });
});
