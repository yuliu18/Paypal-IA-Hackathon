// Process-wide guard dependencies for the app. The audit log is one SQLite file shared by every
// request; it is kept on globalThis so Next.js dev reloads don't open it twice.

import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { createSqliteAuditLog, type SqliteAuditLog } from './adapters/sqlite-audit-log';

const globalForGuard = globalThis as typeof globalThis & { guardAuditLog?: SqliteAuditLog };

export function auditLog(): SqliteAuditLog {
  if (!globalForGuard.guardAuditLog) {
    const path = process.env.GUARD_AUDIT_DB ?? 'data/guard-audit.db';
    mkdirSync(dirname(path), { recursive: true });
    globalForGuard.guardAuditLog = createSqliteAuditLog(path);
  }
  return globalForGuard.guardAuditLog;
}
