// Ports of the payment guard: what the core needs from the outside world. Adapters for
// PayPal, the LLM provider and storage implement these, so each can be swapped freely.

import type { CaptureFacts, Decision, Money, TaskMandate } from './domain/policy';

// The task the agent is working on, as the business framed it. `untrustedInput` is what an
// outsider wrote (e.g. the customer's email) and must never be treated as instructions.
export type AgentTask = {
  mandate: TaskMandate;
  instructions: string;
  untrustedInput: string;
};

export type ToolCall = { tool: string; args: Record<string, unknown> };

export interface IntentJudge {
  judge(input: { task: AgentTask; call: ToolCall }): Promise<Decision>;
}

export interface CaptureLookup {
  getCapture(captureId: string): Promise<CaptureFacts>;
}

export type AuditEntry = {
  at: string;
  tool: string;
  args: Record<string, unknown>;
  task: AgentTask;
  decision: Decision;
  // Amount that moved or may have moved: set before execution and cleared only when PayPal
  // explicitly rejects the call, so ambiguous failures still count toward limits.
  moved?: Money;
  // `held` waits for a person and moved nothing.
  outcome: 'pending' | 'executed' | 'blocked' | 'held' | 'error';
  detail?: string;
  // The held entry this one decides (a person's approval or rejection).
  resolves?: string;
};

export type AuditRow = AuditEntry & { id: string };

export interface AuditLog {
  // Returns the entry id. Writes are logged as `pending` before they run (write-ahead).
  record(entry: AuditEntry): Promise<string>;
  update(id: string, patch: Partial<Pick<AuditEntry, 'outcome' | 'moved' | 'detail'>>): Promise<void>;
  movedSince(since: Date, currency: string): Promise<Money>;
  // Whether a refund of this capture may have moved money but never settled (pending, or failed
  // with its amount still counting), so a retry could refund twice.
  hasUnsettledRefund(captureId: string): Promise<boolean>;
  get(id: string): Promise<AuditRow | undefined>;
  // Whether a later entry already decides this held entry.
  isResolved(id: string): Promise<boolean>;
}
