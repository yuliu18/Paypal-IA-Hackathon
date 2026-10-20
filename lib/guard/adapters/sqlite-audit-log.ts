// AuditLog on SQLite (Node's built-in node:sqlite, no native dependency). Every guard decision
// becomes one row; amounts are stored in minor units so daily totals are exact sums.

import { DatabaseSync } from 'node:sqlite';
import type { Money } from '../domain/policy';
import type { AuditEntry, AuditLog } from '../ports';

export type AuditRow = AuditEntry & { id: string };

export type SqliteAuditLog = AuditLog & { list(limit: number): AuditRow[] };

type DbRow = {
  id: number;
  at: string;
  tool: string;
  args: string;
  task: string;
  decision: string;
  moved_minor: number | null;
  moved_currency: string | null;
  outcome: AuditEntry['outcome'];
  detail: string | null;
};

const toEntry = (row: DbRow): AuditRow => ({
  id: String(row.id),
  at: row.at,
  tool: row.tool,
  args: JSON.parse(row.args),
  task: JSON.parse(row.task),
  decision: JSON.parse(row.decision),
  moved: row.moved_minor === null || row.moved_currency === null ? undefined : { minor: row.moved_minor, currency: row.moved_currency },
  outcome: row.outcome,
  detail: row.detail ?? undefined,
});

export function createSqliteAuditLog(path: string): SqliteAuditLog {
  const db = new DatabaseSync(path);
  db.exec(`
    CREATE TABLE IF NOT EXISTS audit (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      at TEXT NOT NULL,
      tool TEXT NOT NULL,
      args TEXT NOT NULL,
      task TEXT NOT NULL,
      decision TEXT NOT NULL,
      moved_minor INTEGER,
      moved_currency TEXT,
      outcome TEXT NOT NULL,
      detail TEXT
    );
    CREATE INDEX IF NOT EXISTS audit_at ON audit (at);
  `);

  const insert = db.prepare(
    `INSERT INTO audit (at, tool, args, task, decision, moved_minor, moved_currency, outcome, detail)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  // Pending entries count too: their call may have moved money even if it never settled.
  const sumSince = db.prepare(
    `SELECT COALESCE(SUM(moved_minor), 0) AS total FROM audit WHERE at >= ? AND moved_currency = ?`,
  );
  const latest = db.prepare(`SELECT * FROM audit ORDER BY id DESC LIMIT ?`);

  return {
    async record(entry) {
      const { lastInsertRowid } = insert.run(
        entry.at,
        entry.tool,
        JSON.stringify(entry.args),
        JSON.stringify(entry.task),
        JSON.stringify(entry.decision),
        entry.moved?.minor ?? null,
        entry.moved?.currency ?? null,
        entry.outcome,
        entry.detail ?? null,
      );
      return String(lastInsertRowid);
    },

    async update(id, patch) {
      const sets: string[] = [];
      const values: (string | number | null)[] = [];
      if (patch.outcome !== undefined) {
        sets.push('outcome = ?');
        values.push(patch.outcome);
      }
      if (patch.detail !== undefined) {
        sets.push('detail = ?');
        values.push(patch.detail);
      }
      // Presence, not value, decides: an explicit `moved: undefined` clears the amount.
      if ('moved' in patch) {
        sets.push('moved_minor = ?', 'moved_currency = ?');
        values.push(patch.moved?.minor ?? null, patch.moved?.currency ?? null);
      }
      if (!sets.length) return;
      db.prepare(`UPDATE audit SET ${sets.join(', ')} WHERE id = ?`).run(...values, Number(id));
    },

    async movedSince(since, currency): Promise<Money> {
      const { total } = sumSince.get(since.toISOString(), currency) as { total: number };
      return { minor: total, currency };
    },

    list(limit) {
      return (latest.all(limit) as unknown as DbRow[]).map(toEntry);
    },
  };
}
