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

const facts: CaptureFacts = { captureId: 'CAP-1', status: 'COMPLETED', captured: usd(5000), refunded: usd(0), payerEmail: 'ana@example.com' };

let upstreamCalls: { name: string; args: unknown }[];
let entries: AuditEntry[];
let judgeDecision: Decision;
let judgeCalls: number;

const audit: AuditLog = {
  async record(entry) {
    entries.push(entry);
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
    ok('create_refund'),
  );
  server.registerTool('cancel_subscription', { description: 'cancel', inputSchema: { id: z.string() } }, ok('cancel_subscription'));
  return server;
}

async function connect(captures = { getCapture: async () => facts }) {
  const [upClient, upServer] = InMemoryTransport.createLinkedPair();
  await fakePayPal().connect(upServer);
  const upstream = new Client({ name: 'guard-upstream', version: '0.0.0' });
  await upstream.connect(upClient);

  const guard = createPaymentGuard({
    upstream,
    task,
    judge,
    captures,
    audit,
    limits: { perRefund: usd(10000), daily: usd(20000) },
    now: () => new Date('2026-10-20T12:00:00Z'),
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
});

describe('payment guard', () => {
  it('exposes the upstream PayPal tools unchanged', async () => {
    const agent = await connect();
    const { tools } = await agent.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual(['cancel_subscription', 'create_refund', 'get_order']);
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
    const agent = await connect({ getCapture: async () => ({ ...facts, payerEmail: 'attacker@example.com' }) });
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
