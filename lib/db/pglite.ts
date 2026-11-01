// Db on PGlite: real Postgres compiled to WebAssembly, in process. Tests only (a dev dependency),
// so the Postgres stores run their behaviour tests without a server or a Neon connection.

import { PGlite } from '@electric-sql/pglite';
import type { Db, Queryable, Row } from './db.ts';

export async function createPgliteDb(): Promise<Db> {
  const pg = await PGlite.create();
  const run = (client: Pick<PGlite, 'query'>): Queryable => ({
    async query<R extends Row = Row>(text: string, params?: unknown[]) {
      const result = await client.query<R>(text, params);
      return { rows: result.rows };
    },
  });
  return {
    ...run(pg),
    transaction: (work) => pg.transaction((tx) => work(run(tx))),
    close: () => pg.close(),
  };
}
