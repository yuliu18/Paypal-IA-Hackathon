// The payment guard: an MCP server that sits between an AI agent and PayPal's MCP toolkit.
// It exposes the same tools, passes allowlisted reads through, evaluates refunds against the
// policy and the intent judge, and blocks everything else by default. Blocked calls never
// reach PayPal.

import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { CallToolRequestSchema, ListToolsRequestSchema, type CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { toMinor } from './adapters/paypal-capture-lookup';
import { evaluateRefund, mergeDecisions, type Decision, type Limits, type Money, type RefundRequest } from './domain/policy';
import type { AgentTask, AuditLog, CaptureLookup, IntentJudge } from './ports';

// Single-record reads a support agent needs. Bulk reads such as list_transactions would expose
// every customer's data, so they stay blocked like any tool not listed here.
const READ_TOOLS = new Set(['get_order', 'get_refund']);
const isRead = (tool: string) => READ_TOOLS.has(tool);

export type GuardDeps = {
  upstream: Client;
  task: AgentTask;
  judge: IntentJudge;
  captures: CaptureLookup;
  audit: AuditLog;
  limits: Limits;
  now?: () => Date;
};

// Writes run one at a time across every guard in the process, so the daily total read by one
// refund already includes the refund before it; otherwise concurrent calls, even from different
// tasks, could all pass the daily limit together. A multi-instance deployment needs a DB lock.
let writeQueue: Promise<unknown> = Promise.resolve();
function serialized<T>(work: () => Promise<T>): Promise<T> {
  const run = writeQueue.then(work, work);
  writeQueue = run.catch(() => undefined);
  return run;
}

const block = (code: string, message: string): Decision => ({ verdict: 'block', violations: [{ code, message }] });

function blockedResult(decision: Decision): CallToolResult {
  const reasons = decision.violations.map((v) => `${v.code}: ${v.message}`).join('; ');
  return { isError: true, content: [{ type: 'text', text: `Blocked by payment guard. ${reasons}` }] };
}

const MONEY_VALUE = /^\d+(\.\d{1,2})?$/;

function parseRefund(args: Record<string, unknown>): RefundRequest | undefined {
  if (typeof args.capture_id !== 'string' || !args.capture_id) return undefined;
  if (args.amount === undefined) return { captureId: args.capture_id };
  const amount = args.amount as { currency_code?: unknown; value?: unknown };
  if (typeof amount?.currency_code !== 'string' || typeof amount.value !== 'string' || !MONEY_VALUE.test(amount.value)) return undefined;
  return { captureId: args.capture_id, amount: toMinor({ value: amount.value, currency_code: amount.currency_code }) };
}

export function createPaymentGuard({ upstream, task, judge, captures, audit, limits, now = () => new Date() }: GuardDeps): Server {
  const server = new Server({ name: 'paypal-payment-guard', version: '0.1.0' }, { capabilities: { tools: {} } });

  server.setRequestHandler(ListToolsRequestSchema, (request) => upstream.listTools(request.params));

  async function decideRefund(args: Record<string, unknown>): Promise<{ decision: Decision; moved?: Money }> {
    const request = parseRefund(args);
    if (!request) return { decision: block('INVALID_ARGUMENTS', 'create_refund needs capture_id and an optional {currency_code, value} amount') };

    let capture;
    try {
      capture = await captures.getCapture(request.captureId);
    } catch (error) {
      return { decision: block('CAPTURE_LOOKUP_FAILED', error instanceof Error ? error.message : String(error)) };
    }

    const moved = request.amount ?? { minor: capture.captured.minor - capture.refunded.minor, currency: capture.captured.currency };
    const startOfDay = new Date(now());
    startOfDay.setUTCHours(0, 0, 0, 0);
    const refundedToday = await audit.movedSince(startOfDay, moved.currency);

    const policy = evaluateRefund({ request, capture, mandate: task.mandate, limits, refundedToday });
    // Only a policy-clean call is worth an LLM round trip; the judge can't relax a block anyway.
    if (policy.verdict === 'block') return { decision: policy };
    return { decision: mergeDecisions(policy, await judge.judge({ task, call: { tool: 'create_refund', args } })), moved };
  }

  server.setRequestHandler(CallToolRequestSchema, (request) => {
    const { name } = request.params;
    const args = request.params.arguments ?? {};
    return isRead(name) ? handle(name, args) : serialized(() => handle(name, args));
  });

  async function handle(name: string, args: Record<string, unknown>): Promise<CallToolResult> {
    const at = now().toISOString();

    let decision: Decision;
    let moved: Money | undefined;
    if (isRead(name)) decision = { verdict: 'allow', violations: [] };
    else if (name === 'create_refund') ({ decision, moved } = await decideRefund(args));
    else decision = block('TOOL_NOT_ALLOWED', `${name} is not covered by the guard policy`);

    if (decision.verdict === 'block') {
      // The call is refused either way; a failed log write must not turn a block into an error.
      await audit.record({ at, tool: name, args, task, decision, outcome: 'blocked' }).catch(() => undefined);
      return blockedResult(decision);
    }

    // Reads move no money, so they don't depend on the log: run them and log afterwards.
    if (isRead(name)) {
      const result = (await upstream.callTool({ name, arguments: args })) as CallToolResult;
      await audit.record({ at, tool: name, args, task, decision, outcome: result.isError ? 'error' : 'executed' }).catch(() => undefined);
      return result;
    }

    // Write-ahead: log the call with the amount it may move before it runs. If that fails, the
    // call can't be accounted for, so it doesn't run.
    let id: string;
    try {
      id = await audit.record({ at, tool: name, args, task, decision, outcome: 'pending', moved });
    } catch (error) {
      return blockedResult(block('AUDIT_UNAVAILABLE', error instanceof Error ? error.message : String(error)));
    }

    // Update failures are ignored: the pending entry already counts the amount, which errs safe.
    const settle = (patch: Parameters<AuditLog['update']>[1]) => audit.update(id, patch).catch(() => undefined);
    try {
      const result = (await upstream.callTool({ name, arguments: args })) as CallToolResult;
      // An explicit PayPal rejection moved nothing, so it stops counting toward limits.
      await settle(result.isError ? { outcome: 'error', moved: undefined } : { outcome: 'executed' });
      return result;
    } catch (error) {
      // Transport failure: PayPal may have executed the call, so the amount keeps counting.
      const detail = error instanceof Error ? error.message : String(error);
      await settle({ outcome: 'error', detail });
      return { isError: true, content: [{ type: 'text', text: `PayPal call failed: ${detail}` }] };
    }
  }

  return server;
}
