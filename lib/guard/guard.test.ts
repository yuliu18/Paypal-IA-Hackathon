import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import type { CaptureFacts, Decision, Money } from './domain/policy';
import { createPaymentGuard } from './guard';
import type { AuditEntry, AuditLog, IntentJudge } from './ports';

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
};

const judge: IntentJudge = {
  async judge() {
    judgeCalls++;
    return judgeDecision;
  },
};

function fakePayPal() {
  const server = new McpServer({ name: 'fake-paypal', version: '0.0.0' });
  const ok = (name: string) => async (args: unknown) => {
    upstreamCalls.push({ name, args });
    return { content: [{ type: 'text' as const, text: `${name} ok` }] };
  };
  server.registerTool('get_order', { description: 'get', inputSchema: { id: z.string() } }, ok('get_order'));
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
  captures = { getCapture: async () => facts },
  { upstreamThrows = false, upstreamHangs = false, upstreamLate = undefined as 'ok' | 'rejected' | undefined } = {},
) {
  const [upClient, upServer] = InMemoryTransport.createLinkedPair();
  await fakePayPal().connect(upServer);
  const upstream = new Client({ name: 'guard-upstream', version: '0.0.0' });
  await upstream.connect(upClient);
  if (upstreamThrows) {
    // A transport failure after PayPal may already have executed the call.
    upstream.callTool = async (params) => {
      upstreamCalls.push({ name: params.name, args: params.arguments });
      throw new Error('socket hang up');
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
    limits: { perRefund: usd(10000), daily: usd(20000) },
    now: () => new Date('2026-10-20T12:00:00Z'),
    timeoutMs: 50,
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
});

describe('payment guard', () => {
  it('exposes the upstream PayPal tools unchanged', async () => {
    const agent = await connect();
    const { tools } = await agent.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual(['cancel_subscription', 'create_refund', 'get_order', 'list_transactions']);
  });

  it('passes read tools straight through and logs them', async () => {
    const agent = await connect();
    const result = await agent.callTool({ name: 'get_order', arguments: { id: 'ORD-1' } });
    expect(text(result)).toBe('get_order ok');
    expect(upstreamCalls).toEqual([{ name: 'get_order', args: { id: 'ORD-1' } }]);
    expect(entries.map((e) => e.outcome)).toEqual(['executed']);
    expect(judgeCalls).toBe(0);
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

  it('enforces the daily limit across refunds already executed', async () => {
    const agent = await connect();
    const big = { capture_id: 'CAP-1', amount: { currency_code: 'USD', value: '50.00' } };
    for (let i = 0; i < 4; i++) await agent.callTool({ name: 'create_refund', arguments: big });
    const fifth = await agent.callTool({ name: 'create_refund', arguments: big });
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

  it('counts a refund whose PayPal call failed ambiguously toward the daily limit', async () => {
    const agent = await connect(undefined, { upstreamThrows: true });
    const big = { capture_id: 'CAP-1', amount: { currency_code: 'USD', value: '50.00' } };
    for (let i = 0; i < 4; i++) await agent.callTool({ name: 'create_refund', arguments: big });
    const fifth = await agent.callTool({ name: 'create_refund', arguments: big });
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
    const big = { capture_id: 'CAP-1', amount: { currency_code: 'USD', value: '50.00' } };
    for (let i = 0; i < 4; i++) await agent.callTool({ name: 'create_refund', arguments: big });
    const fifth = await agent.callTool({ name: 'create_refund', arguments: big });
    expect(text(fifth)).toContain('DAILY_LIMIT');
    expect(upstreamCalls).toHaveLength(4);
    expect(entries.slice(0, 4).every((e) => e.outcome === 'pending')).toBe(true);
  });

  it('serves allowlisted reads even when the audit log is down', async () => {
    auditFails = true;
    const agent = await connect();
    const result = await agent.callTool({ name: 'get_order', arguments: { id: 'ORD-1' } });
    expect(text(result)).toBe('get_order ok');
  });

  it('logs a read once, after it ran, with no amount', async () => {
    const agent = await connect();
    await agent.callTool({ name: 'get_order', arguments: { id: 'ORD-1' } });
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ tool: 'get_order', outcome: 'executed' });
    expect(entries[0].moved).toBeUndefined();
  });

  it('times out a hung PayPal refund, keeps counting it, and frees the queue', async () => {
    const agent = await connect(undefined, { upstreamHangs: true });
    const big = { capture_id: 'CAP-1', amount: { currency_code: 'USD', value: '50.00' } };
    const first = await agent.callTool({ name: 'create_refund', arguments: big });
    expect(text(first)).toContain('timed out');
    expect(entries[0]).toMatchObject({ outcome: 'error', moved: usd(5000) });
    await agent.callTool({ name: 'create_refund', arguments: big });
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
  });

  it('blocks a refund whose capture lookup hangs', async () => {
    const agent = await connect({ getCapture: () => new Promise(() => undefined) });
    const result = await agent.callTool({ name: 'create_refund', arguments: { capture_id: 'CAP-1' } });
    expect(text(result)).toContain('CAPTURE_LOOKUP_FAILED');
    expect(upstreamCalls).toEqual([]);
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
