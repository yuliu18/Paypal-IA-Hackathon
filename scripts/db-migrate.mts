// Applies the database migrations (lib/db/migrations.ts) to DATABASE_URL: schemas `auth` (accounts,
// reserved) and `guard` (the guard's black box and settings). Safe to run on every deploy: what is
// already applied is skipped. The server also runs them before its first query.
// Uses the direct connection (DATABASE_URL_UNPOOLED) when set, as Neon advises for migrations.
// Run with: npm run db:migrate   (reads .env.local when present)

import { migrate } from '../lib/db/migrations.ts';
import { createPgDb } from '../lib/db/pg.ts';

const url = process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL;
if (!url) {
  console.log('DATABASE_URL is not set: nothing to migrate (the app uses SQLite and data/settings.json).');
  process.exit(0);
}
const db = createPgDb(url, { max: 1 });
try {
  const applied = await migrate(db);
  console.log(applied.length ? `Applied migrations ${applied.join(', ')}.` : 'The database is up to date.');
} catch (error) {
  // The driver's message names the failing statement, never the connection string.
  console.error('Migration failed:', (error as Error).message);
  process.exitCode = 1;
} finally {
  await db.close();
}
