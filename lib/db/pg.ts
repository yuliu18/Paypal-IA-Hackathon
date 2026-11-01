// Db on node-postgres (pg): the driver Neon recommends for a long-running Node server such as
// Render, with one pool reused across requests.

import pg from 'pg';
import type { Db, Queryable, Row } from './db.ts';

// Neon's strings say sslmode=require, which pg 8 already treats as verify-full (certificate and host
// checked) while warning that pg 9 will weaken it; naming verify-full keeps today's check for good.
function strictSsl(connectionString: string): string {
  try {
    const url = new URL(connectionString);
    if (['prefer', 'require', 'verify-ca'].includes(url.searchParams.get('sslmode') ?? '')) url.searchParams.set('sslmode', 'verify-full');
    return url.toString();
  } catch {
    return connectionString;
  }
}

export function createPgDb(connectionString: string, options: { max?: number } = {}): Db {
  const pool = new pg.Pool({ connectionString: strictSsl(connectionString), max: options.max ?? 5, idleTimeoutMillis: 30_000, connectionTimeoutMillis: 15_000 });
  // Neon closes idle connections when its compute scales to zero. An idle client's error would
  // otherwise crash the process; the pool drops that client and opens a new one when needed.
  pool.on('error', (error) => console.error('Postgres connection closed', error.message));
  const run = (client: pg.Pool | pg.PoolClient): Queryable => ({
    async query<R extends Row = Row>(text: string, params?: unknown[]) {
      const result = await client.query(text, params);
      return { rows: result.rows as R[] };
    },
  });
  return {
    ...run(pool),
    async transaction(work) {
      const client = await pool.connect();
      // A connection whose rollback failed is in an unknown state: the pool discards it.
      let broken: Error | undefined;
      try {
        await client.query('BEGIN');
        const result = await work(run(client));
        await client.query('COMMIT');
        return result;
      } catch (error) {
        await client.query('ROLLBACK').catch((rollback: Error) => (broken = rollback));
        throw error;
      } finally {
        client.release(broken);
      }
    },
    close: () => pool.end(),
  };
}
