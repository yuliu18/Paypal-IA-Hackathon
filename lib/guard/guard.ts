// The payment guard: an MCP server that sits between an AI agent and PayPal's MCP toolkit.
// It exposes the same tools, passes reads through, evaluates refunds against the policy and
// the intent judge, and blocks every other write by default. Blocked calls never reach PayPal.

import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { CallToolRequestSchema, ListToolsRequestSchema, type CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { toMinor } from './adapters/paypal-capture-lookup';
import { evaluateRefund, mergeDecisions, type Decision, type Limits, type Money, type RefundRequest } from './domain/policy';
import type { AgentTask, AuditLog, CaptureLookup, IntentJudge } from './ports';

const READ_PREFIXES = ['get_', 'list_', 'show_'];
const isRead = (tool: string) => READ_PREFIXES.some((prefix) => tool.startsWith(prefix));

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
      await audit.record({ at, tool: name, args, task, decision, outcome: 'blocked' });
      return blockedResult(decision);
    }

    try {
      const result = (await upstream.callTool({ name, arguments: args })) as CallToolResult;
      const failed = Boolean(result.isError);
      await audit.record({ at, tool: name, args, task, decision, outcome: failed ? 'error' : 'executed', moved: failed ? undefined : moved });
      return result;
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      await audit.record({ at, tool: name, args, task, decision, outcome: 'error', detail });
      return { isError: true, content: [{ type: 'text', text: `PayPal call failed: ${detail}` }] };
    }
  }

  return server;
}
