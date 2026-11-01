// Process-wide guard dependencies for the app. The audit log is the guard's black box, shared by
// every request: on Postgres (schema `guard`) when DATABASE_URL is set, so it survives restarts and
// hosts without a persistent disk; otherwise one SQLite file (GUARD_AUDIT_DB). It is kept on
// globalThis so Next.js dev reloads don't open it twice.

import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { getDb } from '@/lib/db/client';
import { createPostgresAuditLog } from './adapters/postgres-audit-log';
import { createSqliteAuditLog, type SqliteAuditLog } from './adapters/sqlite-audit-log';
import type { BlackBox } from './ports';

const globalForGuard = globalThis as typeof globalThis & { guardAuditLog?: BlackBox };

export function auditLog(): BlackBox {
  if (!globalForGuard.guardAuditLog) {
    const db = getDb();
    globalForGuard.guardAuditLog = db ? createPostgresAuditLog(db) : sqliteBlackBox();
  }
  return globalForGuard.guardAuditLog;
}

function sqliteBlackBox(): BlackBox {
  const path = process.env.GUARD_AUDIT_DB ?? 'data/guard-audit.db';
  mkdirSync(dirname(path), { recursive: true });
  return asBlackBox(createSqliteAuditLog(path));
}

// SQLite answers synchronously; the pages read every store the same async way.
export function asBlackBox(log: SqliteAuditLog): BlackBox {
  return {
    record: (entry) => log.record(entry),
    update: (id, patch) => log.update(id, patch),
    movedSince: (since, currency) => log.movedSince(since, currency),
    billedSince: (since, currency) => log.billedSince(since, currency),
    hasUnsettledRefund: (captureId) => log.hasUnsettledRefund(captureId),
    get: (id) => log.get(id),
    isResolved: (id) => log.isResolved(id),
    boundOrderCustomer: (orderId) => log.boundOrderCustomer(orderId),
    list: async (limit) => log.list(limit),
    verifyChain: async (reuseFullCheckMs, now) => log.verifyChain(reuseFullCheckMs, now),
  };
}
