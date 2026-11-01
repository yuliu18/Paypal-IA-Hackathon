// The app's one Postgres connection, from DATABASE_URL. Unset (local development, tests), there is
// none and the guard keeps its SQLite file and settings.json. The pool lives on globalThis so dev
// reloads don't open another one, and migrations run once per process before the first query.

import type { Db, Queryable, Row } from './db.ts';
import { migrate } from './migrations.ts';
import { createPgDb } from './pg.ts';

const globalForDb = globalThis as typeof globalThis & { appDb?: { url: string; db: Db } };

export const databaseConfigured = (env: NodeJS.ProcessEnv = process.env) => Boolean(env.DATABASE_URL);

// Undefined when DATABASE_URL is not set.
export function getDb(env: NodeJS.ProcessEnv = process.env): Db | undefined {
  const url = env.DATABASE_URL;
  if (!url) return undefined;
  if (globalForDb.appDb?.url !== url) globalForDb.appDb = { url, db: migratedOnFirstUse(createPgDb(url)) };
  return globalForDb.appDb.db;
}

// Runs a query on the app database (migrated first). Throws when DATABASE_URL is not set.
export async function query<R extends Row = Row>(text: string, params?: unknown[]): Promise<R[]> {
  const db = getDb();
  if (!db) throw new Error('DATABASE_URL is not set');
  return (await db.query<R>(text, params)).rows;
}

// Waits for the migrations before the first query; a failed run is retried by the next query
// instead of leaving the process without a database until restart.
function migratedOnFirstUse(db: Db): Db {
  let ready: Promise<unknown> | undefined;
  const whenReady = () => {
    ready ??= migrate(db).catch((error) => {
      ready = undefined;
      throw error;
    });
    return ready;
  };
  return {
    async query<R extends Row = Row>(text: string, params?: unknown[]) {
      await whenReady();
      return db.query<R>(text, params);
    },
    async transaction<T>(work: (tx: Queryable) => Promise<T>) {
      await whenReady();
      return db.transaction(work);
    },
    close: () => db.close(),
  };
}
