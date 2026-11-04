// The built-in owner account without a database: a SQLite file (Node's built-in node:sqlite) with
// the same tables as the Postgres store, times kept as ISO 8601 text (they sort as they compare).
// The file is created readable by the server's user only.

import { closeSync, existsSync, mkdirSync, openSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { LocalAuthStore } from './local-store.ts';

export function createSqliteAuthStore(path: string): LocalAuthStore {
  mkdirSync(dirname(path), { recursive: true });
  if (!existsSync(path)) closeSync(openSync(path, 'a', 0o600));
  const db = new DatabaseSync(path);
  // The server and npm run owner:reset may write at the same time: wait instead of failing.
  db.exec(`PRAGMA busy_timeout = 5000; PRAGMA journal_mode = WAL;`);
  db.exec(`
    CREATE TABLE IF NOT EXISTS owner (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      email TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS sessions (
      token_hash TEXT PRIMARY KEY,
      created_at TEXT NOT NULL,
      expires_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS sessions_expires_at ON sessions (expires_at);
  `);

  const iso = (date: Date) => date.toISOString();
  const selectOwner = db.prepare(`SELECT email, password_hash FROM owner WHERE id = 1`);
  const insertOwner = db.prepare(`INSERT OR IGNORE INTO owner (id, email, password_hash, created_at, updated_at) VALUES (1, ?, ?, ?, ?)`);
  const updatePassword = db.prepare(`UPDATE owner SET password_hash = ?, updated_at = ? WHERE id = 1`);
  const deleteExpired = db.prepare(`DELETE FROM sessions WHERE expires_at <= ?`);
  const insertSession = db.prepare(`INSERT INTO sessions (token_hash, created_at, expires_at) VALUES (?, ?, ?)`);
  const selectSession = db.prepare(`SELECT expires_at FROM sessions WHERE token_hash = ? AND EXISTS (SELECT 1 FROM owner WHERE id = 1)`);
  const deleteOne = db.prepare(`DELETE FROM sessions WHERE token_hash = ?`);
  const deleteAll = db.prepare(`DELETE FROM sessions`);

  return {
    async owner() {
      const row = selectOwner.get() as { email: string; password_hash: string } | undefined;
      return row ? { email: row.email, passwordHash: row.password_hash } : null;
    },
    async createOwner({ email, passwordHash }, now) {
      return Number(insertOwner.run(email, passwordHash, iso(now), iso(now)).changes) === 1;
    },
    async setPassword(passwordHash, now) {
      db.exec('BEGIN IMMEDIATE');
      try {
        if (Number(updatePassword.run(passwordHash, iso(now)).changes) === 0) {
          db.exec('ROLLBACK');
          return false;
        }
        deleteAll.run();
        db.exec('COMMIT');
        return true;
      } catch (error) {
        if (db.isTransaction) db.exec('ROLLBACK');
        throw error;
      }
    },
    async createSession(tokenHash, expiresAt, now) {
      deleteExpired.run(iso(now));
      insertSession.run(tokenHash, iso(now), iso(expiresAt));
    },
    async hasSession(tokenHash, now) {
      const row = selectSession.get(tokenHash) as { expires_at: string } | undefined;
      if (!row) return false;
      if (row.expires_at > iso(now)) return true;
      deleteOne.run(tokenHash);
      return false;
    },
    async deleteSession(tokenHash) {
      deleteOne.run(tokenHash);
    },
    async deleteAllSessions() {
      deleteAll.run();
    },
    close: () => db.close(),
  };
}
