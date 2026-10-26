// The payment guard: an MCP server that sits between an AI agent and PayPal's MCP toolkit.
// It exposes the same tools, passes allowlisted reads through, evaluates refunds, subscription
// cancellations, dispute acceptances and invoices against the policy and the intent judge, and
// blocks everything else by default.
// Blocked and held calls never reach PayPal; a held call waits for a person to approve it.

import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { CallToolRequestSchema, ListToolsRequestSchema, type CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { toMinor } from './adapters/paypal-capture-lookup';
import { evaluateCancellation, SUBSCRIPTION_ID } from './domain/cancellation';
import { DISPUTE_ID, evaluateDisputeAcceptance } from './domain/dispute';
import { toDisputeFacts } from './adapters/paypal-dispute-lookup';
import { toInvoiceFacts } from './adapters/paypal-invoice-lookup';
import {
  DEFAULT_INVOICE_LIMITS,
  evaluateInvoiceCreation,
  evaluateInvoiceSending,
  INVOICE_ID,
  parseInvoiceDraft,
  parseInvoiceSending,
  type InvoiceLimits,
} from './domain/invoice';
import { minimizeDispute, minimizeInvoice, minimizeOrder, minimizeSubscription, withheldDetail } from './domain/privacy';
import { maskPersonalData } from './domain/redact';
import { evaluateRefund, format, isMandateCustomer, mergeDecisions, refundableOf, type Decision, type Limits, type Money, type RefundRequest } from './domain/policy';
import type {
  AgentTask,
  AuditEntry,
  AuditLog,
  AuditRow,
  CaptureLookup,
  CustomerDirectory,
  DisputeLookup,
  HeldNotifier,
  IntentJudge,
  InvoiceLookup,
  SubscriptionLookup,
} from './ports';

// Single-record reads a support agent needs, each returned only when it belongs to the ticket
// customer. Bulk reads such as list_transactions would expose every customer's data, and
// get_refund's answer doesn't say whose refund it is, so they stay blocked like any tool not listed.
const READ_TOOLS = new Set(['get_order', 'show_subscription_details', 'get_dispute', 'get_invoice']);
const isRead = (tool: string) => READ_TOOLS.has(tool);

// The toolkit pastes these ids into the request path, so only a plain id may reach it.
const PLAIN_ID_ARGS: Record<string, { arg: string; pattern: RegExp; noun: string }> = {
  show_subscription_details: { arg: 'subscription_id', pattern: SUBSCRIPTION_ID, noun: 'subscription id' },
  get_dispute: { arg: 'dispute_id', pattern: DISPUTE_ID, noun: 'dispute id' },
  get_invoice: { arg: 'invoice_id', pattern: INVOICE_ID, noun: 'invoice id' },
};
function plainIdViolation(tool: string, args: Record<string, unknown>): Decision | undefined {
  const rule = PLAIN_ID_ARGS[tool];
  if (!rule) return undefined;
  const value = args[rule.arg];
  return typeof value === 'string' && rule.pattern.test(value) ? undefined : block('INVALID_ARGUMENTS', `${rule.arg} must be a plain ${rule.noun}`);
}

export type GuardDeps = {
  upstream: Client;
  task: AgentTask;
  judge: IntentJudge;
  captures: CaptureLookup;
  // Without it, every cancel_subscription is blocked (SUBSCRIPTION_LOOKUP_FAILED).
  subscriptions?: SubscriptionLookup;
  // Without it, every accept_dispute_claim is blocked (DISPUTE_LOOKUP_FAILED).
  disputes?: DisputeLookup;
  // Without it, every send_invoice and send_invoice_reminder is blocked (INVOICE_LOOKUP_FAILED).
  invoices?: InvoiceLookup;
  // Without it, every create_invoice is blocked (CUSTOMER_LOOKUP_FAILED).
  customers?: CustomerDirectory;
  audit: AuditLog;
  limits: Limits;
  // The invoice limits, apart from the refund ones; DEFAULT_INVOICE_LIMITS when omitted.
  invoiceLimits?: InvoiceLimits;
  now?: () => Date;
  // Bound on each PayPal lookup and call, so one hung request can't stall the write queue.
  timeoutMs?: number;
  // Tells a person a refund or cancellation waits for them. Optional: without it, holds wait silently on /guard.
  notifier?: HeldNotifier;
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

// Fire and forget: the agent's answer never waits for the notification, and a notifier that
// throws or rejects can't change the hold, which is already recorded.
function notifyHeld(notifier: HeldNotifier | undefined, entry: AuditRow) {
  if (!notifier) return;
  try {
    notifier.notifyHeld(entry).catch(() => undefined);
  } catch {
    // A notifier that throws before returning a promise is ignored the same way.
  }
}

const block = (code: string, message: string): Decision => ({ verdict: 'block', violations: [{ code, message }] });

function blockedResult(decision: Decision): CallToolResult {
  const reasons = decision.violations.map((v) => `${v.code}: ${v.message}`).join('; ');
  return { isError: true, content: [{ type: 'text', text: `Blocked by payment guard. ${reasons}` }] };
}

// The writes the guard can decide, by tool: how the agent and a person hear about a held one, and
// which lookup failure (and of what source) says nothing about the call itself.
type Write = { held: string; noun: string; looksUp: string; lookupFailed: string; source?: string };
const WRITES: Record<string, Write> = {
  create_refund: { held: 'Refund held for human approval', noun: 'refund', looksUp: 'capture', lookupFailed: 'CAPTURE_LOOKUP_FAILED' },
  cancel_subscription: { held: 'Cancellation held for human approval', noun: 'cancellation', looksUp: 'subscription', lookupFailed: 'SUBSCRIPTION_LOOKUP_FAILED' },
  accept_dispute_claim: { held: 'Dispute acceptance held for human approval', noun: 'dispute acceptance', looksUp: 'dispute', lookupFailed: 'DISPUTE_LOOKUP_FAILED' },
  create_invoice: { held: 'Invoice held for human approval', noun: 'invoice', looksUp: 'customer', lookupFailed: 'CUSTOMER_LOOKUP_FAILED', source: 'The customer directory' },
  send_invoice: { held: 'Invoice sending held for human approval', noun: 'invoice sending', looksUp: 'invoice', lookupFailed: 'INVOICE_LOOKUP_FAILED' },
  send_invoice_reminder: { held: 'Invoice reminder held for human approval', noun: 'invoice reminder', looksUp: 'invoice', lookupFailed: 'INVOICE_LOOKUP_FAILED' },
};
const isDecidedWrite = (tool: string) => Object.hasOwn(WRITES, tool);
const capitalized = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

// Not an error: the agent should tell the customer the call is under review, not retry it.
function heldResult(tool: string, decision: Decision): CallToolResult {
  const reasons = decision.violations.map((v) => `${v.code}: ${v.message}`).join('; ');
  return { content: [{ type: 'text', text: `${WRITES[tool].held}; it has not been executed. Tell the customer a person will review it. ${reasons}` }] };
}

const answerOf = (result: CallToolResult): unknown => {
  const part = result.content[0];
  return JSON.parse(part?.type === 'text' ? part.text : '');
};

// Whether a read's answer belongs to the ticket customer. get_order: every purchase unit's
// custom_id (the customer the shop charged); show_subscription_details: the subscriber's email;
// get_dispute: the customer the shop charged for the disputed capture, since PayPal hides the
// customer's email from the shop; get_invoice: its only recipient. An answer that can't be read,
// or checked, is withheld too.
async function readBelongsTo(
  tool: string,
  result: CallToolResult,
  mandate: AgentTask['mandate'],
  { captures, timeoutMs }: Pick<WriteDeps, 'captures' | 'timeoutMs'>,
): Promise<boolean> {
  try {
    if (tool === 'get_dispute') {
      const { captureId } = toDisputeFacts(answerOf(result));
      if (!captureId) return false;
      const capture = await withTimeout(captures.getCapture(captureId), timeoutMs, 'Capture lookup');
      return isMandateCustomer(capture.customerEmail, mandate);
    }
    if (tool === 'get_invoice') {
      const { recipientEmails } = toInvoiceFacts(answerOf(result));
      return recipientEmails.length === 1 && isMandateCustomer(recipientEmails[0], mandate);
    }
    if (tool === 'show_subscription_details') {
      const subscription = answerOf(result) as { subscriber?: { email_address?: string } } | null;
      return isMandateCustomer(subscription?.subscriber?.email_address, mandate);
    }
    const order = answerOf(result) as { purchase_units?: { custom_id?: string }[] } | null;
    const units = order?.purchase_units ?? [];
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

// What checking and executing a write needs, shared by the agent's calls and a person's approval.
type WriteDeps = {
  upstream: Client;
  captures: CaptureLookup;
  subscriptions?: SubscriptionLookup;
  disputes?: DisputeLookup;
  invoices?: InvoiceLookup;
  customers?: CustomerDirectory;
  audit: AuditLog;
  limits: Limits;
  invoiceLimits: InvoiceLimits;
  now: () => Date;
  timeoutMs: number;
};

const startOfDayOf = (now: () => Date) => {
  const start = new Date(now());
  start.setUTCHours(0, 0, 0, 0);
  return start;
};

const message = (error: unknown) => (error instanceof Error ? error.message : String(error));
const failedResult = (detail: string): CallToolResult => ({ isError: true, content: [{ type: 'text', text: `PayPal call failed: ${detail}` }] });

// The deterministic checks of a refund. A person's approval lifts the approval threshold and
// nothing else: the ceiling, the daily limit and the capture's state still apply.
async function checkRefund(
  { captures, audit, limits, now, timeoutMs }: WriteDeps,
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

const MAX_REASON = 128;

// cancel_subscription's arguments as the toolkit takes them: a plain id and PayPal's reason text.
function parseCancellation(args: Record<string, unknown>): { subscriptionId: string } | undefined {
  const payload = args.payload as { reason?: unknown } | undefined;
  if (typeof args.subscription_id !== 'string' || !SUBSCRIPTION_ID.test(args.subscription_id)) return undefined;
  if (typeof payload?.reason !== 'string' || !payload.reason.trim() || payload.reason.length > MAX_REASON) return undefined;
  return { subscriptionId: args.subscription_id };
}

// The deterministic checks of a cancellation. `cancellationsThisTicket` is 0 on a person's
// approval: the held cancellation is the ticket's one.
async function checkCancellation(
  { subscriptions, timeoutMs }: WriteDeps,
  task: AgentTask,
  args: Record<string, unknown>,
  cancellationsThisTicket: number,
): Promise<Decision> {
  const request = parseCancellation(args);
  if (!request) {
    return block('INVALID_ARGUMENTS', `cancel_subscription needs a plain subscription_id and payload.reason of 1 to ${MAX_REASON} characters`);
  }
  let subscription;
  try {
    if (!subscriptions) throw new Error('No subscription lookup is configured');
    subscription = await withTimeout(subscriptions.getSubscription(request.subscriptionId), timeoutMs, 'Subscription lookup');
  } catch (error) {
    return block('SUBSCRIPTION_LOOKUP_FAILED', maskPersonalData(message(error)));
  }
  if (!subscription) return block('SUBSCRIPTION_LOOKUP_FAILED', `Subscription ${request.subscriptionId} was not found in PayPal`);
  return evaluateCancellation({ subscription, mandate: task.mandate, cancellationsThisTicket });
}

// The toolkit checks the note against its dispute id pattern, so a note with spaces never reaches
// PayPal; the guard says so up front instead of letting the agent read a validation error.
const DISPUTE_NOTE = /^[A-Za-z0-9_-]{1,255}$/;

function parseAcceptance(args: Record<string, unknown>): { disputeId: string } | undefined {
  if (typeof args.dispute_id !== 'string' || !DISPUTE_ID.test(args.dispute_id)) return undefined;
  if (typeof args.note !== 'string' || !DISPUTE_NOTE.test(args.note)) return undefined;
  return { disputeId: args.dispute_id };
}

// The deterministic checks of accepting a dispute claim, which refunds the disputed amount. Like a
// refund, a person's approval lifts the approval threshold and nothing else.
async function checkDisputeAcceptance(
  { disputes, captures, audit, limits, now, timeoutMs }: WriteDeps,
  task: AgentTask,
  args: Record<string, unknown>,
  approvedByPerson: boolean,
): Promise<{ decision: Decision; moved?: Money }> {
  const request = parseAcceptance(args);
  if (!request) {
    return { decision: block('INVALID_ARGUMENTS', 'accept_dispute_claim needs a plain dispute_id and a note of letters, digits, _ or - (the toolkit accepts no spaces)') };
  }
  let dispute;
  try {
    if (!disputes) throw new Error('No dispute lookup is configured');
    dispute = await withTimeout(disputes.getDispute(request.disputeId), timeoutMs, 'Dispute lookup');
  } catch (error) {
    return { decision: block('DISPUTE_LOOKUP_FAILED', maskPersonalData(message(error))) };
  }
  if (!dispute) return { decision: block('DISPUTE_LOOKUP_FAILED', `Dispute ${request.disputeId} was not found in PayPal`) };
  // Without the disputed capture there is no owner and no refundable amount to check against.
  if (!dispute.captureId) return { decision: block('CAPTURE_MISMATCH', `Dispute ${dispute.id} names no single capture of the shop`) };
  if (await audit.hasUnsettledRefund(dispute.captureId)) {
    return { decision: block('REFUND_UNCONFIRMED', `An earlier refund of capture ${dispute.captureId} is not confirmed yet; a person must check it in PayPal first`) };
  }

  let capture;
  try {
    capture = await withTimeout(captures.getCapture(dispute.captureId), timeoutMs, 'Capture lookup');
  } catch (error) {
    // PayPal unreachable, as for the dispute itself: a held acceptance stays open to try again.
    return { decision: block('DISPUTE_LOOKUP_FAILED', `Capture lookup: ${maskPersonalData(message(error))}`) };
  }

  const startOfDay = new Date(now());
  startOfDay.setUTCHours(0, 0, 0, 0);
  const refundedToday = await audit.movedSince(startOfDay, dispute.amount.currency);
  const applied = approvedByPerson ? { ...limits, approvalThreshold: limits.perRefund } : limits;
  return { decision: evaluateDisputeAcceptance({ dispute, capture, mandate: task.mandate, limits: applied, refundedToday }), moved: dispute.amount };
}

// The deterministic checks of an invoice: whom it bills, whether the shop knows them, and the
// invoice limits. Its total is recorded as the amount billed, which only the invoice daily cap
// counts. Like a refund, a person's approval lifts the approval threshold and nothing else.
async function checkInvoiceCreation(
  { customers, audit, invoiceLimits, now, timeoutMs }: WriteDeps,
  task: AgentTask,
  args: Record<string, unknown>,
  approvedByPerson: boolean,
): Promise<{ decision: Decision; moved?: Money }> {
  const parsed = parseInvoiceDraft(args);
  if ('invalid' in parsed) return { decision: block('INVALID_ARGUMENTS', parsed.invalid) };
  const { draft } = parsed;
  let known;
  try {
    if (!customers) throw new Error('No customer directory is configured');
    known = await withTimeout(customers.isCustomer(task.mandate.customerEmail), timeoutMs, 'Customer lookup');
  } catch (error) {
    return { decision: block('CUSTOMER_LOOKUP_FAILED', maskPersonalData(message(error))) };
  }
  const billedToday = await audit.billedSince(startOfDayOf(now), draft.total.currency);
  const limits = approvedByPerson ? { ...invoiceLimits, approvalThreshold: invoiceLimits.perInvoice } : invoiceLimits;
  return { decision: evaluateInvoiceCreation({ draft, mandate: task.mandate, known, limits, billedToday }), moved: draft.total };
}

// The deterministic checks of sending an invoice or a reminder of it, which move no money.
// `remindersOf` gives 0 on a person's approval: the held reminder is the task's one.
async function checkInvoiceSending(
  { invoices, timeoutMs }: WriteDeps,
  task: AgentTask,
  call: { tool: string; args: Record<string, unknown> },
  remindersOf: (invoiceId: string) => number,
): Promise<Decision> {
  const parsed = parseInvoiceSending(call.tool, call.args);
  if ('invalid' in parsed) return block('INVALID_ARGUMENTS', parsed.invalid);
  let invoice;
  try {
    if (!invoices) throw new Error('No invoice lookup is configured');
    invoice = await withTimeout(invoices.getInvoice(parsed.invoiceId), timeoutMs, 'Invoice lookup');
  } catch (error) {
    return block('INVOICE_LOOKUP_FAILED', maskPersonalData(message(error)));
  }
  if (!invoice) return block('INVOICE_LOOKUP_FAILED', `Invoice ${parsed.invoiceId} was not found in PayPal`);
  const reminder = call.tool === 'send_invoice_reminder';
  return evaluateInvoiceSending({ invoice, mandate: task.mandate, reminder, remindersThisTask: reminder ? remindersOf(parsed.invoiceId) : 0 });
}

type TaskCounts = { approvedByPerson: boolean; cancellationsThisTicket: number; remindersOf: (invoiceId: string) => number };

// The deterministic checks of any write the guard decides. A cancellation, an invoice sending and
// a reminder move no money.
async function checkWrite(
  deps: WriteDeps,
  task: AgentTask,
  call: { tool: string; args: Record<string, unknown> },
  { approvedByPerson, cancellationsThisTicket, remindersOf }: TaskCounts,
): Promise<{ decision: Decision; moved?: Money }> {
  if (call.tool === 'cancel_subscription') return { decision: await checkCancellation(deps, task, call.args, cancellationsThisTicket) };
  if (call.tool === 'accept_dispute_claim') return checkDisputeAcceptance(deps, task, call.args, approvedByPerson);
  if (call.tool === 'create_invoice') return checkInvoiceCreation(deps, task, call.args, approvedByPerson);
  if (call.tool === 'send_invoice' || call.tool === 'send_invoice_reminder') return { decision: await checkInvoiceSending(deps, task, call, remindersOf) };
  return checkRefund(deps, task, call.args, approvedByPerson);
}

// Write-ahead execution: log the call with the amount it may move before it runs. If that fails,
// the call can't be accounted for, so it doesn't run.
async function executeWrite(
  { upstream, audit, timeoutMs }: WriteDeps,
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
    // The log keeps the raw message; the agent gets it masked, like any PayPal error text.
    return failedResult(maskPersonalData(message(error)));
  }
}

// The order, subscription, dispute or invoice the agent sees: only what its write needs, plus the
// paths the guard withheld. Its owner was already checked, and readBelongsTo refuses an answer that isn't JSON.
function withoutPersonalData(tool: string, result: CallToolResult): { result: CallToolResult; withheld: string[] } {
  const answer = answerOf(result);
  let kept: Record<string, unknown>;
  let withheld: string[];
  if (tool === 'show_subscription_details') ({ subscription: kept, withheld } = minimizeSubscription(answer));
  else if (tool === 'get_dispute') ({ dispute: kept, withheld } = minimizeDispute(answer));
  else if (tool === 'get_invoice') ({ invoice: kept, withheld } = minimizeInvoice(answer));
  else ({ order: kept, withheld } = minimizeOrder(answer));
  return { result: { content: [{ type: 'text', text: JSON.stringify({ ...kept, withheld_by_guard: withheld }) }] }, withheld };
}

// PayPal's error answers are free text that can quote the payer: masked, not cut, so the agent
// still learns what went wrong.
function withoutPersonalText(result: CallToolResult): CallToolResult {
  return { ...result, content: result.content.map((part) => (part.type === 'text' ? { ...part, text: maskPersonalData(part.text) } : part)) };
}

export type HeldDecision = {
  // `refused`: nothing to decide (unknown id, not a hold, or already decided); nothing was recorded.
  outcome: 'executed' | 'blocked' | 'error' | 'refused';
  message: string;
};
export type HeldRefundDecision = HeldDecision;

const textOf = (result: CallToolResult) => result.content.map((part) => (part.type === 'text' ? part.text : '')).join(' ');

// What a person hears once an approved hold ran in PayPal.
function executedMessage(held: AuditRow, moved: Money | undefined): string {
  const id = (arg: string) => String(held.args[arg]);
  if (held.tool === 'cancel_subscription') return `Subscription ${id('subscription_id')} cancelled in PayPal`;
  if (held.tool === 'send_invoice') return `Invoice ${id('invoice_id')} sent`;
  if (held.tool === 'send_invoice_reminder') return `Reminder for invoice ${id('invoice_id')} sent`;
  const amount = moved ? format(moved) : 'an unknown amount';
  if (held.tool === 'create_invoice') {
    // The number is the agent's text: quoted only when it is a plain one.
    const number = held.args.invoice_number;
    return `Invoice ${typeof number === 'string' && INVOICE_ID.test(number) ? `${number} ` : ''}created in PayPal for ${amount}`;
  }
  if (held.tool === 'accept_dispute_claim') return `Dispute ${id('dispute_id')} accepted in PayPal; it refunds ${amount}`;
  return `Refund of ${amount} executed in PayPal`;
}

// A person approves or rejects a held refund, cancellation, dispute acceptance, invoice, invoice
// sending or reminder. It runs in the same queue as the agents' writes, so two approvals of one
// hold can't both pass the "already decided" check, and the daily totals read here include every
// refund and invoice made since the hold.
export function decideHeldCall(
  {
    now = () => new Date(),
    timeoutMs = 20_000,
    invoiceLimits = DEFAULT_INVOICE_LIMITS,
    ...deps
  }: Omit<WriteDeps, 'now' | 'timeoutMs' | 'invoiceLimits'> & { now?: () => Date; timeoutMs?: number; invoiceLimits?: InvoiceLimits },
  heldId: string,
  approve: boolean,
): Promise<HeldDecision> {
  const full: WriteDeps = { ...deps, invoiceLimits, now, timeoutMs };
  return serialized(async () => {
    const held = await full.audit.get(heldId);
    if (!held || held.outcome !== 'held' || !isDecidedWrite(held.tool)) {
      return { outcome: 'refused', message: `Entry ${heldId} is not a held refund, cancellation, dispute acceptance, invoice, invoice sending or reminder` };
    }
    const { noun, looksUp, lookupFailed, source = 'PayPal' } = WRITES[held.tool];
    if (await full.audit.isResolved(heldId)) return { outcome: 'refused', message: `Held ${noun} ${heldId} was already decided` };

    const base = { at: now().toISOString(), tool: held.tool, args: held.args, task: held.task, resolves: heldId };
    if (!approve) {
      await full.audit.record({ ...base, decision: block('REJECTED_BY_PERSON', `A person rejected the held ${noun}`), outcome: 'blocked' });
      return { outcome: 'blocked', message: `${capitalized(noun)} rejected; nothing was sent to PayPal` };
    }

    // Approval lifts the approval threshold only; the ticket's one cancellation, and the task's one
    // reminder of an invoice, is this one.
    const { decision, moved } = await checkWrite(full, held.task, held, { approvedByPerson: true, cancellationsThisTicket: 0, remindersOf: () => 0 });
    // A lookup that failed says nothing about the call itself: leave the hold open to try again.
    if (decision.violations.some((v) => v.code === lookupFailed)) {
      return { outcome: 'error', message: `${source} could not be reached to check the ${looksUp}; the ${noun} is still held, try again` };
    }
    if (decision.verdict !== 'allow') {
      await full.audit.record({ ...base, decision, outcome: 'blocked' });
      return { outcome: 'blocked', message: decision.violations.map((v) => `${v.code}: ${v.message}`).join('; ') };
    }
    const approved: Decision = { verdict: 'allow', violations: [{ code: 'APPROVED_BY_PERSON', message: `A person approved the held ${noun}` }] };
    const result = await executeWrite(full, { ...base, decision: approved, moved });
    if (result.isError) return { outcome: 'error', message: textOf(result) };
    return { outcome: 'executed', message: executedMessage(held, moved) };
  });
}

// The name it had when only refunds could be held.
export const decideHeldRefund = decideHeldCall;

export function createPaymentGuard({
  upstream,
  task,
  judge,
  captures,
  subscriptions,
  disputes,
  invoices,
  customers,
  audit,
  limits,
  invoiceLimits = DEFAULT_INVOICE_LIMITS,
  now = () => new Date(),
  timeoutMs = 20_000,
  notifier,
}: GuardDeps): Server {
  const server = new Server({ name: 'paypal-payment-guard', version: '0.1.0' }, { capabilities: { tools: {} } });

  server.setRequestHandler(ListToolsRequestSchema, (request) => upstream.listTools(request.params));

  const deps: WriteDeps = { upstream, captures, subscriptions, disputes, invoices, customers, audit, limits, invoiceLimits, now, timeoutMs };
  // Cancellations this ticket ran or held, and reminders by invoice; writes are serialized, so the
  // counts can't race.
  let cancellations = 0;
  const reminders = new Map<string, number>();
  const remindersOf = (invoiceId: string) => reminders.get(invoiceId) ?? 0;
  // Counted when a write is held or about to run, like cancellations.
  const count = (name: string, args: Record<string, unknown>) => {
    if (name === 'cancel_subscription') cancellations++;
    if (name === 'send_invoice_reminder') reminders.set(String(args.invoice_id), remindersOf(String(args.invoice_id)) + 1);
  };
  const callPayPal = (name: string, args: Record<string, unknown>) =>
    withTimeout(upstream.callTool({ name, arguments: args }) as Promise<CallToolResult>, timeoutMs, `PayPal ${name}`);

  async function decideWrite(tool: string, args: Record<string, unknown>): Promise<{ decision: Decision; moved?: Money }> {
    const { decision: policy, moved } = await checkWrite(deps, task, { tool, args }, { approvedByPerson: false, cancellationsThisTicket: cancellations, remindersOf });
    // Only a policy-clean (or held) call is worth an LLM round trip; the judge can't relax a block anyway.
    if (policy.verdict === 'block') return { decision: policy };
    return { decision: mergeDecisions(policy, await judge.judge({ task, call: { tool, args } })), moved };
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
    const badId = plainIdViolation(name, args);
    if (badId) decision = badId;
    else if (isRead(name)) decision = { verdict: 'allow', violations: [] };
    else if (isDecidedWrite(name)) ({ decision, moved } = await decideWrite(name, args));
    else decision = block('TOOL_NOT_ALLOWED', `${name} is not covered by the guard policy`);

    if (decision.verdict === 'block') {
      // The call is refused either way; a failed log write must not turn a block into an error.
      await audit.record({ at, tool: name, args, task, decision, outcome: 'blocked' }).catch(() => undefined);
      return blockedResult(decision);
    }
    if (decision.verdict === 'hold') {
      // Nothing runs and nothing moves, so the amount stays out of the limits until a person approves.
      const entry: AuditEntry = { at, tool: name, args, task, decision, outcome: 'held' };
      let id: string;
      try {
        id = await audit.record(entry);
      } catch (error) {
        // A hold nobody can see would never be approved: refuse it instead.
        return blockedResult(block('AUDIT_UNAVAILABLE', message(error)));
      }
      count(name, args);
      notifyHeld(notifier, { ...entry, id });
      return heldResult(name, decision);
    }

    // Reads move no money, so they don't depend on the log: run them and log afterwards.
    if (isRead(name)) {
      try {
        const result = await callPayPal(name, args);
        if (!result.isError && !(await readBelongsTo(name, result, task.mandate, deps))) {
          const what = { show_subscription_details: 'Subscription', get_dispute: 'Dispute', get_invoice: 'Invoice' }[name] ?? 'Order';
          const withheld = block('CUSTOMER_MISMATCH', `${what} is not one of the ticket customer ${task.mandate.customerEmail}`);
          await audit.record({ at, tool: name, args, task, decision: withheld, outcome: 'blocked' }).catch(() => undefined);
          return blockedResult(withheld);
        }
        if (result.isError) {
          await audit.record({ at, tool: name, args, task, decision, outcome: 'error' }).catch(() => undefined);
          return withoutPersonalText(result);
        }
        const minimized = withoutPersonalData(name, result);
        const detail = withheldDetail(minimized.withheld);
        await audit.record({ at, tool: name, args, task, decision, outcome: 'executed', ...(detail && { detail }) }).catch(() => undefined);
        return minimized.result;
      } catch (error) {
        await audit.record({ at, tool: name, args, task, decision, outcome: 'error', detail: message(error) }).catch(() => undefined);
        return failedResult(maskPersonalData(message(error)));
      }
    }

    // Counted before it runs: a cancellation or reminder that may have reached PayPal is the task's one.
    count(name, args);
    return executeWrite(deps, { at, tool: name, args, task, decision, moved });
  }

  return server;
}
