// The small database interface the app's Postgres stores use. Two implementations: node-postgres
// against DATABASE_URL (./pg.ts, the server) and an in-process PGlite (./pglite.ts, tests only).
// Relative imports carry their .ts extension so plain Node (scripts) can load these files.

export type Row = Record<string, unknown>;

export interface Queryable {
  // One statement, with $1..$n parameters.
  query<R extends Row = Row>(text: string, params?: unknown[]): Promise<{ rows: R[] }>;
}

export interface Db extends Queryable {
  // Runs `work` in one transaction on one connection: committed when it resolves, rolled back when
  // it throws (the error is rethrown).
  transaction<T>(work: (tx: Queryable) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

// A schema name the app builds into SQL (it can't be a parameter): lowercase identifier only.
export function schemaName(name: string): string {
  if (!/^[a-z_][a-z0-9_]{0,62}$/.test(name)) throw new Error(`Not a valid schema name: ${name}`);
  return name;
}
