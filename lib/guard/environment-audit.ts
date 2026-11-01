// The audit log as one request's guard sees it: every entry it records says which PayPal
// environment (sandbox or live) the decision ran in, whatever the entry itself claims.

import type { AuditLog, PaymentEnvironment } from './ports';

export type EnvironmentAuditLog = AuditLog & { readonly environment: PaymentEnvironment; readonly log: AuditLog };

export function inEnvironment(log: AuditLog, environment: PaymentEnvironment): EnvironmentAuditLog {
  return {
    environment,
    log,
    record: (entry) => log.record({ ...entry, environment }),
    update: (id, patch) => log.update(id, patch),
    movedSince: (since, currency) => log.movedSince(since, currency),
    billedSince: (since, currency) => log.billedSince(since, currency),
    hasUnsettledRefund: (captureId) => log.hasUnsettledRefund(captureId),
    get: (id) => log.get(id),
    isResolved: (id) => log.isResolved(id),
    boundOrderCustomer: (orderId, orderEnvironment) => log.boundOrderCustomer(orderId, orderEnvironment),
  };
}
