// Live check of the Postgres stores against the real database (DATABASE_URL, e.g. Neon), inside a
// throwaway schema guard_probe_<random> that is dropped at the end: the real `guard` schema gets no
// rows. Checks migrations, the black box (appends, settlements, the hash chain, concurrent appends
// from several connections, tamper detection) and the settings row with its generated key.
// Run with: npm run db:probe   (never prints the connection string)

import { randomBytes } from 'node:crypto';
import { migrate } from '../lib/db/migrations.ts';
import { createPgDb } from '../lib/db/pg.ts';
import { createPostgresAuditLog } from '../lib/guard/adapters/postgres-audit-log.ts';
import type { AuditEntry } from '../lib/guard/ports.ts';
import { createPostgresSettingsStore } from '../lib/settings/postgres-store.ts';

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL is not set.');
  process.exit(1);
}

const schema = `guard_probe_${randomBytes(4).toString('hex')}`;
const CONNECTIONS = 4;
const APPENDS = 10;
const db = createPgDb(url, { max: 2 });
const others = Array.from({ length: CONNECTIONS }, () => createPgDb(url, { max: 1 }));
let failures = 0;
const check = (label: string, ok: boolean, detail = '') => {
  if (!ok) failures++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}${detail ? ` (${detail})` : ''}`);
};

const entry = (overrides: Partial<AuditEntry> = {}): AuditEntry => ({
  at: new Date().toISOString(),
  tool: 'create_refund',
  args: { capture_id: 'PROBE-CAP' },
  task: { mandate: { customerEmail: 'probe@example.com' }, instructions: 'Probe.', untrustedInput: 'Probe.' },
  decision: { verdict: 'allow', violations: [] },
  outcome: 'pending',
  moved: { minor: 100, currency: 'USD' },
  ...overrides,
});

console.log(`Probing the database in schema ${schema}`);
try {
  const applied = await migrate(db, { guardSchema: schema, authSchema: null });
  check('migrations applied', applied.length > 0, `versions ${applied.join(', ')}`);
  check('migrations idempotent', (await migrate(db, { guardSchema: schema, authSchema: null })).length === 0);

  const log = createPostgresAuditLog(db, { schema });
  const id = await log.record(entry());
  check('pending refund counts as unsettled', await log.hasUnsettledRefund('PROBE-CAP'));
  await log.update(id, { outcome: 'executed', detail: 'probe' });
  const live = await log.record(entry({ environment: 'live', outcome: 'blocked', moved: undefined }));
  check('settlement applied, environment recorded', (await log.get(id))?.outcome === 'executed' && (await log.get(live))?.environment === 'live');
  check('moved since today', (await log.movedSince(new Date(Date.now() - 60_000), 'USD')).minor === 100);

  // Several connections append at once, as several server processes would.
  await Promise.all(others.map((other) => (async () => {
    const theirs = createPostgresAuditLog(other, { schema });
    for (let i = 0; i < APPENDS; i++) await theirs.record(entry({ moved: undefined, outcome: 'blocked' }));
  })()));
  const chain = await log.verifyChain();
  const expected = 3 + CONNECTIONS * APPENDS;
  check('one unbroken chain after concurrent appends', chain.intact && chain.records === expected, JSON.stringify(chain.intact ? { records: chain.records } : chain));

  await db.query(`UPDATE ${schema}.audit_log SET moved_minor = 1 WHERE id = $1`, [Number(id)]);
  const tampered = await log.verifyChain();
  check('an edited row is found', !tampered.intact && tampered.brokenAt === id, JSON.stringify(tampered));

  const store = createPostgresSettingsStore(db, { schema });
  await store.createKey();
  const key = await store.readKey();
  await store.write('{"business":{"name":"Probe","contactEmails":[],"refundPolicy":"probe"}}');
  check('settings row and generated key', key.length >= 16 && (await store.read())?.includes('Probe') === true);
} catch (error) {
  failures++;
  console.error('Probe failed:', (error as Error).message);
} finally {
  await db.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`).catch((error) => {
    failures++;
    console.error(`Could not drop ${schema}:`, (error as Error).message);
  });
  const left = await db.query(`SELECT 1 FROM pg_namespace WHERE nspname = $1`, [schema]);
  check(`throwaway schema ${schema} dropped`, left.rows.length === 0);
  await Promise.all([db.close(), ...others.map((other) => other.close())]);
}
process.exitCode = failures ? 1 : 0;
