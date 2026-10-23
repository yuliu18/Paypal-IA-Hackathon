import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import type { CaptureFacts, Decision, Money } from './domain/policy';
import { createPaymentGuard, decideHeldRefund } from './guard';
import type { AuditEntry, AuditLog, AuditRow, CaptureLookup, HeldNotifier, IntentJudge } from './ports';

const usd = (minor: number): Money => ({ minor, currency: 'USD' });

const task = {
  mandate: { customerEmail: 'ana@example.com' },
  instructions: 'Refund damaged items only.',
  untrustedInput: 'My mug arrived broken, order ORD-1.',
};

const facts: CaptureFacts = { captureId: 'CAP-1', status: 'COMPLETED', captured: usd(5000), refunded: usd(0), customerEmail: 'ana@example.com' };

let upstreamCalls: { name: string; args: unknown }[];
let entries: AuditEntry[];
let judgeDecision: Decision;
let judgeCalls: number;
let auditFails: boolean;
let auditUpdateFails: boolean;
let rejectRefunds: boolean;
let approvalThreshold: Money;

const audit: AuditLog = {
  async record(entry) {
    if (auditFails) throw new Error('disk full');
    entries.push({ ...entry });
    return String(entries.length - 1);
  },
  async update(id, patch) {
    if (auditUpdateFails) throw new Error('disk full');
    Object.assign(entries[Number(id)], patch);
  },
  async movedSince() {
    return usd(entries.reduce((sum, e) => sum + (e.moved?.minor ?? 0), 0));
  },
  async hasUnsettledRefund(captureId) {
    return entries.some((e) => e.tool === 'create_refund' && e.args.capture_id === captureId && e.moved && (e.outcome === 'pending' || e.outcome === 'error'));
  },
  async get(id) {
    const entry = entries[Number(id)];
    return entry && { ...entry, id };
  },
  async isResolved(id) {
    return entries.some((e) => e.resolves === id);
  },
};

const judge: IntentJudge = {
  async judge() {
    judgeCalls++;
    return judgeDecision;
  },
};

// Orders as PayPal's get_order returns them: the shop's custom_id names the customer.
const order = (id: string, customer: string) => JSON.stringify({ id, purchase_units: [{ custom_id: customer, payments: { captures: [{ id: `CAP-${id}` }] } }] });
const ORDERS: Record<string, string> = {
  'ORD-1': order('ORD-1', 'ana@example.com'),
  'ORD-2': order('ORD-2', 'ben@example.com'),
  'ORD-MIXED': JSON.stringify({ id: 'ORD-MIXED', purchase_units: [{ custom_id: 'ana@example.com' }, { custom_id: 'ben@example.com' }] }),
  'ORD-GARBLED': 'not json',
};

function fakePayPal() {
  const server = new McpServer({ name: 'fake-paypal', version: '0.0.0' });
  const ok = (name: string) => async (args: unknown) => {
    upstreamCalls.push({ name, args });
    return { content: [{ type: 'text' as const, text: `${name} ok` }] };
  };
  server.registerTool('get_order', { description: 'get', inputSchema: { id: z.string() } }, async (args) => {
    upstreamCalls.push({ name: 'get_order', args });
    if (args.id === 'ORD-PII-ERROR') return { isError: true, content: [{ type: 'text' as const, text: 'RESOURCE_NOT_FOUND for payer ben@example.com, card 4111111111111111' }] };
    return { content: [{ type: 'text' as const, text: ORDERS[args.id] ?? 'not found' }] };
  });
  server.registerTool('get_refund', { description: 'get refund', inputSchema: { id: z.string() } }, ok('get_refund'));
  server.registerTool(
    'create_refund',
    { description: 'refund', inputSchema: { capture_id: z.string(), amount: z.object({ currency_code: z.string(), value: z.string() }).optional() } },
    async (args) => {
      if (!rejectRefunds) return ok('create_refund')(args);
      upstreamCalls.push({ name: 'create_refund', args });
      return { isError: true, content: [{ type: 'text' as const, text: 'UNPROCESSABLE_ENTITY' }] };
    },
  );
  server.registerTool('list_transactions', { description: 'list', inputSchema: {} }, ok('list_transactions'));
  server.registerTool('cancel_subscription', { description: 'cancel', inputSchema: { id: z.string() } }, ok('cancel_subscription'));
  return server;
}

async function connect(
  captures: CaptureLookup = { getCapture: async (captureId) => ({ ...facts, captureId }) },
  {
    upstreamThrows = false,
    upstreamHangs = false,
    upstreamLate = undefined as 'ok' | 'rejected' | undefined,
    throwMessage = 'socket hang up',
    notifier = undefined as HeldNotifier | undefined,
  } = {},
) {
  const [upClient, upServer] = InMemoryTransport.createLinkedPair();
  await fakePayPal().connect(upServer);
  const upstream = new Client({ name: 'guard-upstream', version: '0.0.0' });
  await upstream.connect(upClient);
  if (upstreamThrows) {
    // A transport failure after PayPal may already have executed the call.
    upstream.callTool = async (params) => {
      upstreamCalls.push({ name: params.name, args: params.arguments });
      throw new Error(throwMessage);
    };
  }
  if (upstreamHangs) {
    upstream.callTool = (params) => {
      upstreamCalls.push({ name: params.name, args: params.arguments });
      return new Promise(() => undefined);
    };
  }

  if (upstreamLate) {
    // PayPal answers, but only after the guard's timeout (50 ms) has already fired.
    upstream.callTool = (params) => {
      upstreamCalls.push({ name: params.name, args: params.arguments });
      const result = upstreamLate === 'ok'
        ? { content: [{ type: 'text' as const, text: 'refund ok' }] }
        : { isError: true, content: [{ type: 'text' as const, text: 'UNPROCESSABLE_ENTITY' }] };
      return new Promise((resolve) => setTimeout(() => resolve(result), 100));
    };
  }

  const guard = createPaymentGuard({
    upstream,
    task,
    judge,
    captures,
    audit,
    limits: { approvalThreshold, perRefund: usd(10000), daily: usd(20000) },
    now: () => new Date('2026-10-20T12:00:00Z'),
    timeoutMs: 50,
    notifier,
  });
  const [agentSide, guardSide] = InMemoryTransport.createLinkedPair();
  await guard.connect(guardSide);
  const agent = new Client({ name: 'agent', version: '0.0.0' });
  await agent.connect(agentSide);
  return agent;
}

const text = (result: Awaited<ReturnType<Client['callTool']>>) => (result.content as { text: string }[])[0].text;

beforeEach(() => {
  upstreamCalls = [];
  entries = [];
  judgeDecision = { verdict: 'allow', violations: [] };
  judgeCalls = 0;
  auditFails = false;
  auditUpdateFails = false;
  rejectRefunds = false;
  approvalThreshold = usd(10000);
});

describe('payment guard', () => {
  it('exposes the upstream PayPal tools unchanged', async () => {
    const agent = await connect();
    const { tools } = await agent.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual(['cancel_subscription', 'create_refund', 'get_order', 'get_refund', 'list_transactions']);
  });

  it('returns an order of the ticket customer without its personal data, and logs the read', async () => {
    const agent = await connect();
    const result = await agent.callTool({ name: 'get_order', arguments: { id: 'ORD-1' } });
    expect(JSON.parse(text(result))).toEqual({
      id: 'ORD-1',
      purchase_units: [{ payments: { captures: [{ id: 'CAP-ORD-1' }] } }],
      withheld_by_guard: ['purchase_units[0].custom_id'],
    });
    expect(upstreamCalls).toEqual([{ name: 'get_order', args: { id: 'ORD-1' } }]);
    expect(entries.map((e) => e.outcome)).toEqual(['executed']);
    expect(judgeCalls).toBe(0);
  });

  it("withholds another customer's order and logs the read as blocked", async () => {
    const agent = await connect();
    const result = await agent.callTool({ name: 'get_order', arguments: { id: 'ORD-2' } });
    expect(result.isError).toBe(true);
    expect(text(result)).toContain('CUSTOMER_MISMATCH');
    expect(text(result)).not.toContain('ben@example.com');
    expect(entries[0]).toMatchObject({ tool: 'get_order', outcome: 'blocked', decision: { verdict: 'block' } });
  });

  it('withholds an order when any of its purchase units belongs to someone else', async () => {
    const agent = await connect();
    const result = await agent.callTool({ name: 'get_order', arguments: { id: 'ORD-MIXED' } });
    expect(text(result)).toContain('CUSTOMER_MISMATCH');
  });

  it('withholds an order whose customer cannot be read from the PayPal answer', async () => {
    const agent = await connect();
    const result = await agent.callTool({ name: 'get_order', arguments: { id: 'ORD-GARBLED' } });
    expect(result.isError).toBe(true);
    expect(text(result)).toContain('CUSTOMER_MISMATCH');
    expect(text(result)).not.toContain('not json');
  });

  it('blocks get_refund, whose answer does not say which customer it belongs to', async () => {
    const agent = await connect();
    const result = await agent.callTool({ name: 'get_refund', arguments: { id: 'REF-1' } });
    expect(text(result)).toContain('TOOL_NOT_ALLOWED');
    expect(upstreamCalls).toEqual([]);
  });

  it('forwards a refund that passes policy and the judge, recording the money moved', async () => {
    const agent = await connect();
    const args = { capture_id: 'CAP-1', amount: { currency_code: 'USD', value: '25.00' } };
    const result = await agent.callTool({ name: 'create_refund', arguments: args });
    expect(result.isError).toBeFalsy();
    expect(upstreamCalls).toEqual([{ name: 'create_refund', args }]);
    expect(entries[0]).toMatchObject({ tool: 'create_refund', outcome: 'executed', moved: usd(2500), decision: { verdict: 'allow' } });
  });

  it('counts an omitted amount as a full refund of the remaining balance', async () => {
    const agent = await connect();
    await agent.callTool({ name: 'create_refund', arguments: { capture_id: 'CAP-1' } });
    expect(entries[0].moved).toEqual(usd(5000));
  });

  it('blocks a refund that breaks policy without asking the judge or reaching PayPal', async () => {
    const agent = await connect({ getCapture: async () => ({ ...facts, customerEmail: 'attacker@example.com' }) });
    const result = await agent.callTool({ name: 'create_refund', arguments: { capture_id: 'CAP-1' } });
    expect(result.isError).toBe(true);
    expect(text(result)).toContain('CUSTOMER_MISMATCH');
    expect(upstreamCalls).toEqual([]);
    expect(judgeCalls).toBe(0);
    expect(entries[0]).toMatchObject({ outcome: 'blocked', decision: { verdict: 'block' } });
    expect(entries[0].moved).toBeUndefined();
  });

  it('blocks a policy-clean refund the judge rejects', async () => {
    judgeDecision = { verdict: 'block', violations: [{ code: 'INTENT_MISMATCH', message: 'injected instruction' }] };
    const agent = await connect();
    const result = await agent.callTool({ name: 'create_refund', arguments: { capture_id: 'CAP-1' } });
    expect(result.isError).toBe(true);
    expect(text(result)).toContain('injected instruction');
    expect(upstreamCalls).toEqual([]);
  });

  it('holds a refund above the approval threshold without reaching PayPal or counting it', async () => {
    approvalThreshold = usd(2000);
    const agent = await connect();
    const args = { capture_id: 'CAP-1', amount: { currency_code: 'USD', value: '25.00' } };
    const result = await agent.callTool({ name: 'create_refund', arguments: args });
    expect(result.isError).toBeFalsy();
    expect(text(result)).toContain('held for human approval');
    expect(text(result)).toContain('APPROVAL_REQUIRED');
    expect(upstreamCalls).toEqual([]);
    expect(judgeCalls).toBe(1);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ tool: 'create_refund', args, outcome: 'held', decision: { verdict: 'hold' } });
    expect(entries[0].moved).toBeUndefined();
  });

  it('holds a policy-clean refund the judge is unsure about', async () => {
    judgeDecision = { verdict: 'hold', violations: [{ code: 'INTENT_UNCERTAIN', message: 'unclear' }] };
    const agent = await connect();
    const result = await agent.callTool({ name: 'create_refund', arguments: { capture_id: 'CAP-1' } });
    expect(result.isError).toBeFalsy();
    expect(text(result)).toContain('INTENT_UNCERTAIN');
    expect(upstreamCalls).toEqual([]);
    expect(entries[0]).toMatchObject({ outcome: 'held', decision: { verdict: 'hold' } });
  });

  it('blocks a refund it would hold when the hold cannot be logged', async () => {
    approvalThreshold = usd(2000);
    auditFails = true;
    const agent = await connect();
    const result = await agent.callTool({ name: 'create_refund', arguments: { capture_id: 'CAP-1' } });
    expect(result.isError).toBe(true);
    expect(text(result)).toContain('AUDIT_UNAVAILABLE');
    expect(upstreamCalls).toEqual([]);
  });

  it('blocks a held-sized refund the judge rejects', async () => {
    approvalThreshold = usd(2000);
    judgeDecision = { verdict: 'block', violations: [{ code: 'INTENT_MISMATCH', message: 'injected instruction' }] };
    const agent = await connect();
    const result = await agent.callTool({ name: 'create_refund', arguments: { capture_id: 'CAP-1' } });
    expect(result.isError).toBe(true);
    expect(entries[0]).toMatchObject({ outcome: 'blocked', decision: { verdict: 'block' } });
  });

  it('enforces the daily limit across refunds already executed', async () => {
    const agent = await connect();
    const big = (i: number) => ({ capture_id: `CAP-${i}`, amount: { currency_code: 'USD', value: '50.00' } });
    for (let i = 0; i < 4; i++) await agent.callTool({ name: 'create_refund', arguments: big(i) });
    const fifth = await agent.callTool({ name: 'create_refund', arguments: big(4) });
    expect(text(fifth)).toContain('DAILY_LIMIT');
    expect(upstreamCalls).toHaveLength(4);
  });

  it('enforces the daily limit when refunds arrive concurrently', async () => {
    const agent = await connect();
    const big = { capture_id: 'CAP-1', amount: { currency_code: 'USD', value: '50.00' } };
    await Promise.all(Array.from({ length: 5 }, () => agent.callTool({ name: 'create_refund', arguments: big })));
    expect(upstreamCalls).toHaveLength(4);
  });

  it('enforces the daily limit across concurrent tasks with separate guards', async () => {
    const agents = await Promise.all(Array.from({ length: 5 }, () => connect()));
    const big = { capture_id: 'CAP-1', amount: { currency_code: 'USD', value: '50.00' } };
    await Promise.all(agents.map((agent) => agent.callTool({ name: 'create_refund', arguments: big })));
    expect(upstreamCalls).toHaveLength(4);
  });

  it("masks personal data in a failed refund's error before the agent sees it", async () => {
    const agent = await connect(undefined, { upstreamThrows: true, throwMessage: 'payer ben@example.com unreachable' });
    const result = await agent.callTool({ name: 'create_refund', arguments: { capture_id: 'CAP-1', amount: { currency_code: 'USD', value: '10.00' } } });
    expect(text(result)).toContain('payer b***@example.com unreachable');
    expect(entries[0].detail).toBe('payer ben@example.com unreachable');
  });

  it('counts a refund whose PayPal call failed ambiguously toward the daily limit', async () => {
    const agent = await connect(undefined, { upstreamThrows: true });
    const big = (i: number) => ({ capture_id: `CAP-${i}`, amount: { currency_code: 'USD', value: '50.00' } });
    for (let i = 0; i < 4; i++) await agent.callTool({ name: 'create_refund', arguments: big(i) });
    const fifth = await agent.callTool({ name: 'create_refund', arguments: big(4) });
    expect(text(fifth)).toContain('DAILY_LIMIT');
    expect(upstreamCalls).toHaveLength(4);
    expect(entries.slice(0, 4).map((e) => e.outcome)).toEqual(['error', 'error', 'error', 'error']);
  });

  it('does not count a refund PayPal explicitly rejected', async () => {
    rejectRefunds = true;
    const agent = await connect();
    const big = { capture_id: 'CAP-1', amount: { currency_code: 'USD', value: '50.00' } };
    for (let i = 0; i < 5; i++) await agent.callTool({ name: 'create_refund', arguments: big });
    expect(upstreamCalls).toHaveLength(5);
    expect(entries.every((e) => e.outcome === 'error' && e.moved === undefined)).toBe(true);
  });

  it('blocks a refund when it cannot be logged before execution', async () => {
    auditFails = true;
    const agent = await connect();
    const result = await agent.callTool({ name: 'create_refund', arguments: { capture_id: 'CAP-1' } });
    expect(text(result)).toContain('AUDIT_UNAVAILABLE');
    expect(upstreamCalls).toEqual([]);
  });

  it('keeps counting a refund whose log entry cannot be settled after it ran', async () => {
    auditUpdateFails = true;
    const agent = await connect();
    const big = (i: number) => ({ capture_id: `CAP-${i}`, amount: { currency_code: 'USD', value: '50.00' } });
    for (let i = 0; i < 4; i++) await agent.callTool({ name: 'create_refund', arguments: big(i) });
    const fifth = await agent.callTool({ name: 'create_refund', arguments: big(4) });
    expect(text(fifth)).toContain('DAILY_LIMIT');
    expect(upstreamCalls).toHaveLength(4);
    expect(entries.slice(0, 4).every((e) => e.outcome === 'pending')).toBe(true);
  });

  it('serves allowlisted reads even when the audit log is down', async () => {
    auditFails = true;
    const agent = await connect();
    const result = await agent.callTool({ name: 'get_order', arguments: { id: 'ORD-1' } });
    expect(JSON.parse(text(result)).id).toBe('ORD-1');
  });

  it('logs a read once, after it ran, with no amount', async () => {
    const agent = await connect();
    await agent.callTool({ name: 'get_order', arguments: { id: 'ORD-1' } });
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ tool: 'get_order', outcome: 'executed', detail: 'Withheld from the agent: purchase_units[0].custom_id' });
    expect(entries[0].moved).toBeUndefined();
  });

  it('times out a hung PayPal refund, keeps counting it, and frees the queue', async () => {
    const agent = await connect(undefined, { upstreamHangs: true });
    const big = { capture_id: 'CAP-1', amount: { currency_code: 'USD', value: '50.00' } };
    const first = await agent.callTool({ name: 'create_refund', arguments: big });
    expect(text(first)).toContain('timed out');
    expect(entries[0]).toMatchObject({ outcome: 'error', moved: usd(5000) });
    await agent.callTool({ name: 'create_refund', arguments: { ...big, capture_id: 'CAP-2' } });
    expect(upstreamCalls).toHaveLength(2);
  });

  it('blocks another refund of a capture whose earlier refund is still unconfirmed', async () => {
    const agent = await connect(undefined, { upstreamHangs: true });
    const args = { capture_id: 'CAP-1', amount: { currency_code: 'USD', value: '20.00' } };
    await agent.callTool({ name: 'create_refund', arguments: args });
    const retry = await agent.callTool({ name: 'create_refund', arguments: args });
    expect(text(retry)).toContain('REFUND_UNCONFIRMED');
    expect(upstreamCalls).toHaveLength(1);
    expect(entries[1]).toMatchObject({ outcome: 'blocked' });
  });

  it('allows a new refund of a capture once PayPal explicitly rejected the earlier one', async () => {
    rejectRefunds = true;
    const agent = await connect();
    const args = { capture_id: 'CAP-1', amount: { currency_code: 'USD', value: '20.00' } };
    await agent.callTool({ name: 'create_refund', arguments: args });
    rejectRefunds = false;
    const retry = await agent.callTool({ name: 'create_refund', arguments: args });
    expect(retry.isError).toBeFalsy();
    expect(upstreamCalls).toHaveLength(2);
  });

  it('settles a timed-out refund as executed when PayPal completes it later', async () => {
    const agent = await connect(undefined, { upstreamLate: 'ok' });
    const result = await agent.callTool({ name: 'create_refund', arguments: { capture_id: 'CAP-1', amount: { currency_code: 'USD', value: '20.00' } } });
    expect(text(result)).toContain('timed out');
    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(entries[0]).toMatchObject({ outcome: 'executed', moved: usd(2000), detail: 'PayPal completed the call after the guard timed out' });
  });

  it('stops counting a timed-out refund when PayPal later rejects it', async () => {
    const agent = await connect(undefined, { upstreamLate: 'rejected' });
    await agent.callTool({ name: 'create_refund', arguments: { capture_id: 'CAP-1', amount: { currency_code: 'USD', value: '20.00' } } });
    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(entries[0]).toMatchObject({ outcome: 'error', detail: 'PayPal rejected the call after the guard timed out' });
    expect(entries[0].moved).toBeUndefined();
    await agent.callTool({ name: 'create_refund', arguments: { capture_id: 'CAP-1', amount: { currency_code: 'USD', value: '20.00' } } });
    expect(upstreamCalls).toHaveLength(2);
  });

  it('blocks a refund whose capture lookup hangs', async () => {
    const agent = await connect({ getCapture: () => new Promise(() => undefined) });
    const result = await agent.callTool({ name: 'create_refund', arguments: { capture_id: 'CAP-1' } });
    expect(text(result)).toContain('CAPTURE_LOOKUP_FAILED');
    expect(upstreamCalls).toEqual([]);
  });

  it("masks personal data in PayPal's error answers before the agent sees them", async () => {
    const agent = await connect();
    const result = await agent.callTool({ name: 'get_order', arguments: { id: 'ORD-PII-ERROR' } });
    expect(result.isError).toBe(true);
    expect(text(result)).toBe('RESOURCE_NOT_FOUND for payer b***@example.com, card [card •••• 1111]');
  });

  it('returns a structured error and logs a read whose PayPal call fails', async () => {
    const agent = await connect(undefined, { upstreamThrows: true });
    const result = await agent.callTool({ name: 'get_order', arguments: { id: 'ORD-1' } });
    expect(result.isError).toBe(true);
    expect(text(result)).toContain('PayPal call failed');
    expect(entries[0]).toMatchObject({ tool: 'get_order', outcome: 'error', detail: 'socket hang up' });
  });

  it('blocks bulk reads outside the read allowlist', async () => {
    const agent = await connect();
    const result = await agent.callTool({ name: 'list_transactions', arguments: {} });
    expect(result.isError).toBe(true);
    expect(text(result)).toContain('TOOL_NOT_ALLOWED');
    expect(upstreamCalls).toEqual([]);
  });

  it('blocks any other write tool by default', async () => {
    const agent = await connect();
    const result = await agent.callTool({ name: 'cancel_subscription', arguments: { id: 'SUB-1' } });
    expect(result.isError).toBe(true);
    expect(text(result)).toContain('TOOL_NOT_ALLOWED');
    expect(upstreamCalls).toEqual([]);
  });

  it('fails closed when the capture cannot be looked up', async () => {
    const agent = await connect({
      getCapture: async () => {
        throw new Error('PayPal 404');
      },
    });
    const result = await agent.callTool({ name: 'create_refund', arguments: { capture_id: 'CAP-1' } });
    expect(text(result)).toContain('CAPTURE_LOOKUP_FAILED');
    expect(upstreamCalls).toEqual([]);
  });

  it('blocks a refund with malformed arguments', async () => {
    const agent = await connect();
    const result = await agent.callTool({ name: 'create_refund', arguments: { capture_id: 'CAP-1', amount: { value: 'lots' } } });
    expect(text(result)).toContain('INVALID_ARGUMENTS');
    expect(upstreamCalls).toEqual([]);
  });
});

describe('held refund approval', () => {
  let capture: CaptureFacts;

  async function decide(heldId: string, approve: boolean) {
    const [upClient, upServer] = InMemoryTransport.createLinkedPair();
    await fakePayPal().connect(upServer);
    const upstream = new Client({ name: 'approval-upstream', version: '0.0.0' });
    await upstream.connect(upClient);
    return decideHeldRefund(
      {
        upstream,
        captures: { getCapture: async () => capture },
        audit,
        limits: { approvalThreshold: usd(2000), perRefund: usd(10000), daily: usd(20000) },
        now: () => new Date('2026-10-20T13:00:00Z'),
        timeoutMs: 50,
      },
      heldId,
      approve,
    );
  }

  const heldArgs = { capture_id: 'CAP-1', amount: { currency_code: 'USD', value: '25.00' } };
  const hold = { verdict: 'hold' as const, violations: [{ code: 'APPROVAL_REQUIRED', message: 'over' }] };

  beforeEach(() => {
    capture = { ...facts };
    entries.push({ at: '2026-10-20T12:00:00Z', tool: 'create_refund', args: heldArgs, task, decision: hold, outcome: 'held' });
  });

  it('runs an approved refund through PayPal and records it against the held entry', async () => {
    const result = await decide('0', true);
    expect(result.outcome).toBe('executed');
    expect(result.message).toBe('Refund of 25.00 USD executed in PayPal');
    expect(upstreamCalls).toEqual([{ name: 'create_refund', args: heldArgs }]);
    expect(entries[1]).toMatchObject({
      tool: 'create_refund',
      args: heldArgs,
      task,
      resolves: '0',
      outcome: 'executed',
      moved: usd(2500),
      decision: { verdict: 'allow', violations: [{ code: 'APPROVED_BY_PERSON' }] },
    });
  });

  it('refunds only once when the same hold is approved twice', async () => {
    await decide('0', true);
    const second = await decide('0', true);
    expect(second.outcome).toBe('refused');
    expect(second.message).toContain('already decided');
    expect(upstreamCalls).toHaveLength(1);
    expect(entries).toHaveLength(2);
  });

  it('refunds only once when two approvals of the same hold arrive together', async () => {
    const results = await Promise.all([decide('0', true), decide('0', true)]);
    expect(results.map((r) => r.outcome).sort()).toEqual(['executed', 'refused']);
    expect(upstreamCalls).toHaveLength(1);
  });

  it('records a rejection without reaching PayPal, and the hold cannot be approved afterwards', async () => {
    const rejected = await decide('0', false);
    expect(rejected.outcome).toBe('blocked');
    expect(entries[1]).toMatchObject({ resolves: '0', outcome: 'blocked', decision: { verdict: 'block', violations: [{ code: 'REJECTED_BY_PERSON' }] } });
    expect(entries[1].moved).toBeUndefined();
    expect((await decide('0', true)).outcome).toBe('refused');
    expect(upstreamCalls).toEqual([]);
  });

  it('checks the policy again on approval and blocks a refund that no longer fits', async () => {
    capture = { ...facts, refunded: usd(5000), status: 'REFUNDED' };
    const result = await decide('0', true);
    expect(result.outcome).toBe('blocked');
    expect(upstreamCalls).toEqual([]);
    expect(entries[1]).toMatchObject({ resolves: '0', outcome: 'blocked', decision: { verdict: 'block' } });
    expect(entries[1].decision.violations.map((v) => v.code)).toContain('CAPTURE_NOT_REFUNDABLE');
  });

  it('enforces the daily limit at approval time, counting refunds made since the hold', async () => {
    entries.push({ at: '2026-10-20T12:30:00Z', tool: 'create_refund', args: { capture_id: 'CAP-9' }, task, decision: { verdict: 'allow', violations: [] }, outcome: 'executed', moved: usd(19000) });
    const result = await decide('0', true);
    expect(result.outcome).toBe('blocked');
    expect(entries[2].decision.violations.map((v) => v.code)).toEqual(['DAILY_LIMIT']);
    expect(upstreamCalls).toEqual([]);
  });

  it('keeps the hold open when PayPal cannot be reached to re-check it, so it can be approved later', async () => {
    const unreachable = await decideHeldRefund(
      {
        upstream: undefined as unknown as Client,
        captures: { getCapture: async () => { throw new Error('connect timeout'); } },
        audit,
        limits: { approvalThreshold: usd(2000), perRefund: usd(10000), daily: usd(20000) },
        timeoutMs: 50,
      },
      '0',
      true,
    );
    expect(unreachable.outcome).toBe('error');
    expect(entries).toHaveLength(1);
    expect((await decide('0', true)).outcome).toBe('executed');
  });

  it('refuses an id that is not a held refund', async () => {
    entries.push({ at: '2026-10-20T12:30:00Z', tool: 'create_refund', args: heldArgs, task, decision: { verdict: 'allow', violations: [] }, outcome: 'executed', moved: usd(2500) });
    expect((await decide('1', true)).outcome).toBe('refused');
    expect((await decide('99', true)).outcome).toBe('refused');
    expect(upstreamCalls).toEqual([]);
  });
});

describe('held refund notification', () => {
  const capture = (behaviour: () => Promise<void> = async () => undefined) => {
    const notified: AuditRow[] = [];
    const notifier: HeldNotifier = {
      notifyHeld(entry) {
        notified.push(entry);
        return behaviour();
      },
    };
    return { notifier, notified };
  };
  const refund = { capture_id: 'CAP-1', amount: { currency_code: 'USD', value: '25.00' } };

  it('tells a person once about a held refund, with the entry it recorded', async () => {
    approvalThreshold = usd(2000);
    const { notifier, notified } = capture();
    const agent = await connect(undefined, { notifier });
    await agent.callTool({ name: 'create_refund', arguments: refund });
    expect(notified).toHaveLength(1);
    expect(notified[0]).toEqual({ ...entries[0], id: '0' });
    expect(notified[0]).toMatchObject({ tool: 'create_refund', args: refund, outcome: 'held' });
  });

  it('says nothing about refunds it runs or blocks', async () => {
    const { notifier, notified } = capture();
    const agent = await connect(undefined, { notifier });
    await agent.callTool({ name: 'create_refund', arguments: refund });
    judgeDecision = { verdict: 'block', violations: [{ code: 'INTENT_MISMATCH', message: 'injected instruction' }] };
    await agent.callTool({ name: 'create_refund', arguments: { capture_id: 'CAP-2' } });
    expect(entries.map((e) => e.outcome)).toEqual(['executed', 'blocked']);
    expect(notified).toEqual([]);
  });

  it('holds the refund the same way when the notification throws, rejects or never answers', async () => {
    approvalThreshold = usd(2000);
    const failures: (() => Promise<void>)[] = [
      () => {
        throw new Error('webhook down');
      },
      async () => {
        throw new Error('webhook down');
      },
      () => new Promise(() => undefined),
    ];
    for (const behaviour of failures) {
      entries = [];
      const { notifier, notified } = capture(behaviour);
      const agent = await connect(undefined, { notifier });
      const result = await agent.callTool({ name: 'create_refund', arguments: refund });
      expect(result.isError).toBeFalsy();
      expect(text(result)).toContain('held for human approval');
      expect(entries).toHaveLength(1);
      expect(entries[0]).toMatchObject({ outcome: 'held' });
      expect(notified).toHaveLength(1);
    }
    expect(upstreamCalls).toEqual([]);
  });
});
