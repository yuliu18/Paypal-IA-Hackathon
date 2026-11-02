// The built-in owner account on Postgres (DATABASE_URL), in the `auth` schema migration 3 creates.

import { schemaName, type Db } from '../db/db.ts';
import type { LocalAuthStore, LocalOwner } from './local-store.ts';

export function createPgAuthStore(db: Db, { schema = 'auth' }: { schema?: string } = {}): LocalAuthStore {
  const a = schemaName(schema);
  return {
    async owner() {
      const { rows } = await db.query<{ email: string; password_hash: string }>(`SELECT email, password_hash FROM ${a}.owner WHERE id = 1`);
      return rows[0] ? ({ email: rows[0].email, passwordHash: rows[0].password_hash } satisfies LocalOwner) : null;
    },
    async createOwner({ email, passwordHash }, now) {
      // The primary key (id 1 only) makes the set-up atomic: of two at the same moment, one inserts.
      const { rows } = await db.query(
        `INSERT INTO ${a}.owner (id, email, password_hash, created_at, updated_at) VALUES (1, $1, $2, $3, $3) ON CONFLICT (id) DO NOTHING RETURNING id`,
        [email, passwordHash, now],
      );
      return rows.length === 1;
    },
    setPassword(passwordHash, now) {
      return db.transaction(async (tx) => {
        const { rows } = await tx.query(`UPDATE ${a}.owner SET password_hash = $1, updated_at = $2 WHERE id = 1 RETURNING id`, [passwordHash, now]);
        if (rows.length === 0) return false;
        await tx.query(`DELETE FROM ${a}.sessions`);
        return true;
      });
    },
    async createSession(tokenHash, expiresAt, now) {
      await db.query(`DELETE FROM ${a}.sessions WHERE expires_at <= $1`, [now]);
      await db.query(`INSERT INTO ${a}.sessions (token_hash, created_at, expires_at) VALUES ($1, $2, $3)`, [tokenHash, now, expiresAt]);
    },
    async hasSession(tokenHash, now) {
      const { rows } = await db.query<{ live: boolean }>(
        `SELECT s.expires_at > $2 AS live FROM ${a}.sessions s WHERE s.token_hash = $1 AND EXISTS (SELECT 1 FROM ${a}.owner WHERE id = 1)`,
        [tokenHash, now],
      );
      if (rows[0]?.live) return true;
      if (rows[0]) await db.query(`DELETE FROM ${a}.sessions WHERE token_hash = $1 AND expires_at <= $2`, [tokenHash, now]);
      return false;
    },
    async deleteSession(tokenHash) {
      await db.query(`DELETE FROM ${a}.sessions WHERE token_hash = $1`, [tokenHash]);
    },
    async deleteAllSessions() {
      await db.query(`DELETE FROM ${a}.sessions`);
    },
  };
}
