// The black box's row format and hash chain, shared by the SQLite and Postgres adapters so a row
// means and hashes the same in both (a log copied from one to the other keeps its hashes).
// Type-only imports: plain Node loads this file in the multi-process tests.

import { createHash } from 'node:crypto';
import type { AuditEntry, AuditRow, PaymentEnvironment } from '../ports';

// One row of the append-only table, as stored: every column is part of the hash.
export type LogRow = {
  id: number;
  kind: 'record' | 'settle';
  at: string;
  ref: number | null;
  tool: string | null;
  args: string | null;
  task: string | null;
  decision: string | null;
  moved_minor: number | null;
  moved_currency: string | null;
  moved_set: number;
  outcome: string | null;
  detail: string | null;
  resolves: number | null;
  // The PayPal environment a record ran in; null on settlements and on rows written before it was
  // recorded, which read as sandbox (the only environment the guard ran in until then).
  environment: string | null;
  prev_hash: string;
  hash: string;
};

// A record with its settlements applied, as the audit_state view returns it.
export type StateRow = {
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
  resolves: number | null;
  environment: string | null;
};

export const GENESIS = '0'.repeat(64);

// The row id is left out: it is only known after the insert, and the prev_hash links already pin
// each row's place in the chain. The environment joins the hashed content only when set, so rows
// written before it existed keep the hash they were written with.
export function hashOf(row: Omit<LogRow, 'id' | 'hash' | 'environment'> & { environment?: string | null }): string {
  const content: unknown[] = [
    row.prev_hash,
    row.kind,
    row.at,
    row.ref,
    row.tool,
    row.args,
    row.task,
    row.decision,
    row.moved_minor,
    row.moved_currency,
    row.moved_set,
    row.outcome,
    row.detail,
    row.resolves,
  ];
  if (row.environment !== null && row.environment !== undefined) content.push(row.environment);
  return createHash('sha256').update(JSON.stringify(content)).digest('hex');
}

const environmentOf = (stored: string | null): PaymentEnvironment => (stored === 'live' ? 'live' : 'sandbox');

export const toEntry = (row: StateRow): AuditRow => ({
  id: String(row.id),
  at: row.at,
  tool: row.tool,
  args: JSON.parse(row.args),
  task: JSON.parse(row.task),
  decision: JSON.parse(row.decision),
  moved: row.moved_minor === null || row.moved_currency === null ? undefined : { minor: row.moved_minor, currency: row.moved_currency },
  outcome: row.outcome,
  detail: row.detail ?? undefined,
  ...(row.resolves === null ? {} : { resolves: String(row.resolves) }),
  environment: environmentOf(row.environment),
});

// The record row a guard decision appends (before its id and chain columns are known).
export function recordRow(entry: AuditEntry): Omit<LogRow, 'id' | 'prev_hash' | 'hash'> {
  return {
    kind: 'record',
    at: entry.at,
    ref: null,
    tool: entry.tool,
    args: JSON.stringify(entry.args),
    task: JSON.stringify(entry.task),
    decision: JSON.stringify(entry.decision),
    moved_minor: entry.moved?.minor ?? null,
    moved_currency: entry.moved?.currency ?? null,
    moved_set: 1,
    outcome: entry.outcome,
    detail: entry.detail ?? null,
    resolves: entry.resolves === undefined ? null : Number(entry.resolves),
    // Every caller so far runs against the PayPal sandbox.
    environment: entry.environment ?? 'sandbox',
  };
}

// The settlement an update appends, or undefined when the patch changes nothing.
export function settleRow(id: string, patch: Partial<Pick<AuditEntry, 'outcome' | 'moved' | 'detail'>>, at: string): Omit<LogRow, 'id' | 'prev_hash' | 'hash'> | undefined {
  // Presence, not value, decides: an explicit `moved: undefined` clears the amount.
  const movedSet = 'moved' in patch;
  if (patch.outcome === undefined && patch.detail === undefined && !movedSet) return undefined;
  return {
    kind: 'settle',
    at,
    ref: Number(id),
    tool: null,
    args: null,
    task: null,
    decision: null,
    moved_minor: movedSet ? (patch.moved?.minor ?? null) : null,
    moved_currency: movedSet ? (patch.moved?.currency ?? null) : null,
    moved_set: movedSet ? 1 : 0,
    outcome: patch.outcome ?? null,
    detail: patch.detail ?? null,
    resolves: null,
    environment: null,
  };
}

// Repeated from domain/order.ts (boundOrderDetail, ORDER_ID) for the same plain-Node reason; the
// guard and adapter tests pin the same text.
export const ORDER_ID = /^[A-Z0-9]{17,32}$/;
export const boundOrderDetail = (orderId: string) => `Order ${orderId} bound to the task customer`;

// The one customer the executed create_order rows matching an order's binding detail name, or
// undefined. One order is created once; two customers for one id would be a log nobody can trust.
export function soleCustomer(customers: unknown[]): string | undefined {
  const distinct = [...new Set(customers)];
  return distinct.length === 1 && typeof distinct[0] === 'string' ? distinct[0] : undefined;
}
