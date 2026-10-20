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
  // Amount that actually moved, present only for executed money-moving calls.
  moved?: Money;
  outcome: 'executed' | 'blocked' | 'error';
  detail?: string;
};

export interface AuditLog {
  record(entry: AuditEntry): Promise<void>;
  movedSince(since: Date, currency: string): Promise<Money>;
}
