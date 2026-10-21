// The payment guard: an MCP server that sits between an AI agent and PayPal's MCP toolkit.
// It exposes the same tools, passes allowlisted reads through, evaluates refunds against the
// policy and the intent judge, and blocks everything else by default. Blocked and held calls
// never reach PayPal; a held refund waits for a person to approve it.

import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { CallToolRequestSchema, ListToolsRequestSchema, type CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { toMinor } from './adapters/paypal-capture-lookup';
import { evaluateRefund, isMandateCustomer, mergeDecisions, refundableOf, type Decision, type Limits, type Money, type RefundRequest } from './domain/policy';
import type { AgentTask, AuditEntry, AuditLog, CaptureLookup, IntentJudge } from './ports';

// Single-record reads a support agent needs, each returned only when it belongs to the ticket
// customer. Bulk reads such as list_transactions would expose every customer's data, and
// get_refund's answer doesn't say whose refund it is, so they stay blocked like any tool not listed.
const READ_TOOLS = new Set(['get_order']);
const isRead = (tool: string) => READ_TOOLS.has(tool);

export type GuardDeps = {
  upstream: Client;
  task: AgentTask;
  judge: IntentJudge;
  captures: CaptureLookup;
  audit: AuditLog;
  limits: Limits;
  now?: () => Date;
  // Bound on each PayPal lookup and call, so one hung request can't stall the write queue.
  timeoutMs?: number;
};

function withTimeout<T>(work: Promise<T>, ms: number, what: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${what} timed out after ${ms} ms`)), ms);
  });
  return Promise.race([work, timeout]).finally(() => clearTimeout(timer));
}

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

// get_order answers with the order JSON; every purchase unit's custom_id (the customer the shop
// charged) must be the ticket customer. An answer that can't be read is withheld too.
// Not an error: the agent should tell the customer the refund is under review, not retry it.
function heldResult(decision: Decision): CallToolResult {
  const reasons = decision.violations.map((v) => `${v.code}: ${v.message}`).join('; ');
  return { content: [{ type: 'text', text: `Refund held for human approval; it has not been executed. Tell the customer a person will review it. ${reasons}` }] };
}

function orderBelongsTo(result: CallToolResult, mandate: AgentTask['mandate']): boolean {
  const part = result.content[0];
  try {
    const order = JSON.parse(part?.type === 'text' ? part.text : '') as { purchase_units?: { custom_id?: string }[] };
    const units = order.purchase_units ?? [];
    return units.length > 0 && units.every((unit) => isMandateCustomer(unit.custom_id, mandate));
  } catch {
    return false;
  }
}

const MONEY_VALUE = /^\d+(\.\d{1,2})?$/;

function parseRefund(args: Record<string, unknown>): RefundRequest | undefined {
  if (typeof args.capture_id !== 'string' || !args.capture_id) return undefined;
  if (args.amount === undefined) return { captureId: args.capture_id };
  const amount = args.amount as { currency_code?: unknown; value?: unknown };
  if (typeof amount?.currency_code !== 'string' || typeof amount.value !== 'string' || !MONEY_VALUE.test(amount.value)) return undefined;
  return { captureId: args.capture_id, amount: toMinor({ value: amount.value, currency_code: amount.currency_code }) };
}

// What checking and executing a refund needs, shared by the agent's calls and a person's approval.
type RefundDeps = {
  upstream: Client;
  captures: CaptureLookup;
  audit: AuditLog;
  limits: Limits;
  now: () => Date;
  timeoutMs: number;
};

const message = (error: unknown) => (error instanceof Error ? error.message : String(error));
const failedResult = (detail: string): CallToolResult => ({ isError: true, content: [{ type: 'text', text: `PayPal call failed: ${detail}` }] });

// The deterministic checks of a refund. A person's approval lifts the approval threshold and
// nothing else: the ceiling, the daily limit and the capture's state still apply.
async function checkRefund(
  { captures, audit, limits, now, timeoutMs }: RefundDeps,
  task: AgentTask,
  args: Record<string, unknown>,
  approvedByPerson: boolean,
): Promise<{ decision: Decision; moved?: Money }> {
  const request = parseRefund(args);
  if (!request) return { decision: block('INVALID_ARGUMENTS', 'create_refund needs capture_id and an optional {currency_code, value} amount') };
  // A refund of this capture timed out or never settled: PayPal may have executed it, so a
  // retry (which an agent reading "failed" is likely to try) could refund the customer twice.
  if (await audit.hasUnsettledRefund(request.captureId)) {
    return { decision: block('REFUND_UNCONFIRMED', `An earlier refund of capture ${request.captureId} is not confirmed yet; a person must check it in PayPal before another refund`) };
  }

  let capture;
  try {
    capture = await withTimeout(captures.getCapture(request.captureId), timeoutMs, 'Capture lookup');
  } catch (error) {
    return { decision: block('CAPTURE_LOOKUP_FAILED', message(error)) };
  }

  const moved = request.amount ?? refundableOf(capture);
  const startOfDay = new Date(now());
  startOfDay.setUTCHours(0, 0, 0, 0);
  const refundedToday = await audit.movedSince(startOfDay, moved.currency);

  const applied = approvedByPerson ? { ...limits, approvalThreshold: limits.perRefund } : limits;
  return { decision: evaluateRefund({ request, capture, mandate: task.mandate, limits: applied, refundedToday }), moved };
}

// Write-ahead execution: log the call with the amount it may move before it runs. If that fails,
// the call can't be accounted for, so it doesn't run.
async function executeWrite(
  { upstream, audit, timeoutMs }: RefundDeps,
  entry: Omit<AuditEntry, 'outcome'>,
): Promise<CallToolResult> {
  let id: string;
  try {
    id = await audit.record({ ...entry, outcome: 'pending' });
  } catch (error) {
    return blockedResult(block('AUDIT_UNAVAILABLE', message(error)));
  }

  // Update failures are ignored: the pending entry already counts the amount, which errs safe.
  const settle = (patch: Parameters<AuditLog['update']>[1]) => audit.update(id, patch).catch(() => undefined);
  const call = upstream.callTool({ name: entry.tool, arguments: entry.args }) as Promise<CallToolResult>;
  try {
    const result = await withTimeout(call, timeoutMs, `PayPal ${entry.tool}`);
    // An explicit PayPal rejection moved nothing, so it stops counting toward limits.
    await settle(result.isError ? { outcome: 'error', moved: undefined } : { outcome: 'executed' });
    return result;
  } catch (error) {
    // Transport failure or timeout: PayPal may have executed the call, so the amount keeps counting.
    await settle({ outcome: 'error', detail: message(error) });
    // After a timeout the call is still in flight; when PayPal does answer, record what really
    // happened. A call that never answers keeps counting, which errs safe.
    call.then(
      (late) =>
        settle(
          late.isError
            ? { outcome: 'error', moved: undefined, detail: 'PayPal rejected the call after the guard timed out' }
            : { outcome: 'executed', detail: 'PayPal completed the call after the guard timed out' },
        ),
      () => undefined,
    );
    return failedResult(message(error));
  }
}

export type HeldRefundDecision = {
  // `refused`: nothing to decide (unknown id, not a hold, or already decided); nothing was recorded.
  outcome: 'executed' | 'blocked' | 'error' | 'refused';
  message: string;
};

const textOf = (result: CallToolResult) => result.content.map((part) => (part.type === 'text' ? part.text : '')).join(' ');

// A person approves or rejects a held refund. It runs in the same queue as the agents' writes, so
// two approvals of one hold can't both pass the "already decided" check, and the daily total read
// here includes every refund made since the hold.
export function decideHeldRefund(
  { now = () => new Date(), timeoutMs = 20_000, ...deps }: Omit<RefundDeps, 'now' | 'timeoutMs'> & { now?: () => Date; timeoutMs?: number },
  heldId: string,
  approve: boolean,
): Promise<HeldRefundDecision> {
  const full: RefundDeps = { ...deps, now, timeoutMs };
  return serialized(async () => {
    const held = await full.audit.get(heldId);
    if (!held || held.outcome !== 'held' || held.tool !== 'create_refund') return { outcome: 'refused', message: `Entry ${heldId} is not a held refund` };
    if (await full.audit.isResolved(heldId)) return { outcome: 'refused', message: `Held refund ${heldId} was already decided` };

    const base = { at: now().toISOString(), tool: held.tool, args: held.args, task: held.task, resolves: heldId };
    if (!approve) {
      await full.audit.record({ ...base, decision: block('REJECTED_BY_PERSON', 'A person rejected the held refund'), outcome: 'blocked' });
      return { outcome: 'blocked', message: 'Refund rejected; nothing was sent to PayPal' };
    }

    const { decision, moved } = await checkRefund(full, held.task, held.args, true);
    // PayPal unreachable says nothing about the refund itself: leave the hold open to try again.
    if (decision.violations.some((v) => v.code === 'CAPTURE_LOOKUP_FAILED')) {
      return { outcome: 'error', message: 'PayPal could not be reached to check the capture; the refund is still held, try again' };
    }
    if (decision.verdict !== 'allow') {
      await full.audit.record({ ...base, decision, outcome: 'blocked' });
      return { outcome: 'blocked', message: decision.violations.map((v) => `${v.code}: ${v.message}`).join('; ') };
    }
    const approved: Decision = { verdict: 'allow', violations: [{ code: 'APPROVED_BY_PERSON', message: 'A person approved the held refund' }] };
    const result = await executeWrite(full, { ...base, decision: approved, moved });
    return { outcome: result.isError ? 'error' : 'executed', message: textOf(result) };
  });
}

export function createPaymentGuard({
  upstream,
  task,
  judge,
  captures,
  audit,
  limits,
  now = () => new Date(),
  timeoutMs = 20_000,
}: GuardDeps): Server {
  const server = new Server({ name: 'paypal-payment-guard', version: '0.1.0' }, { capabilities: { tools: {} } });

  server.setRequestHandler(ListToolsRequestSchema, (request) => upstream.listTools(request.params));

  const deps: RefundDeps = { upstream, captures, audit, limits, now, timeoutMs };
  const callPayPal = (name: string, args: Record<string, unknown>) =>
    withTimeout(upstream.callTool({ name, arguments: args }) as Promise<CallToolResult>, timeoutMs, `PayPal ${name}`);

  async function decideRefund(args: Record<string, unknown>): Promise<{ decision: Decision; moved?: Money }> {
    const { decision: policy, moved } = await checkRefund(deps, task, args, false);
    // Only a policy-clean (or held) call is worth an LLM round trip; the judge can't relax a block anyway.
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
    if (decision.verdict === 'hold') {
      // Nothing runs and nothing moves, so the amount stays out of the limits until a person approves.
      try {
        await audit.record({ at, tool: name, args, task, decision, outcome: 'held' });
      } catch (error) {
        // A hold nobody can see would never be approved: refuse it instead.
        return blockedResult(block('AUDIT_UNAVAILABLE', message(error)));
      }
      return heldResult(decision);
    }

    // Reads move no money, so they don't depend on the log: run them and log afterwards.
    if (isRead(name)) {
      try {
        const result = await callPayPal(name, args);
        if (!result.isError && !orderBelongsTo(result, task.mandate)) {
          const withheld = block('CUSTOMER_MISMATCH', `Order is not one of the ticket customer ${task.mandate.customerEmail}`);
          await audit.record({ at, tool: name, args, task, decision: withheld, outcome: 'blocked' }).catch(() => undefined);
          return blockedResult(withheld);
        }
        await audit.record({ at, tool: name, args, task, decision, outcome: result.isError ? 'error' : 'executed' }).catch(() => undefined);
        return result;
      } catch (error) {
        await audit.record({ at, tool: name, args, task, decision, outcome: 'error', detail: message(error) }).catch(() => undefined);
        return failedResult(message(error));
      }
    }

    return executeWrite(deps, { at, tool: name, args, task, decision, moved });
  }

  return server;
}
