import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import type { SubscriptionFacts } from './domain/cancellation';
import type { DisputeFacts } from './domain/dispute';
import type { InvoiceFacts, InvoiceLimits } from './domain/invoice';
import type { CaptureFacts, Decision, Money } from './domain/policy';
import { SHOP_CATALOGUE } from '../shop/catalogue';
import { createPaymentGuard, decideHeldCall, decideHeldRefund, type OrderDeps } from './guard';
import type { AuditEntry, AuditLog, AuditRow, CaptureLookup, CustomerDirectory, DisputeLookup, HeldNotifier, IntentJudge, InvoiceLookup, OrderBinder, SubscriptionLookup, ToolCall } from './ports';

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
let judgedCalls: ToolCall[];
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
  // Like the SQLite log: an invoice's amount is money billed, never money refunded, and an order moves none.
  async movedSince() {
    return usd(entries.reduce((sum, e) => sum + (e.tool === 'create_invoice' || e.tool === 'create_order' ? 0 : (e.moved?.minor ?? 0)), 0));
  },
  async billedSince() {
    return usd(entries.reduce((sum, e) => sum + (e.tool === 'create_invoice' ? (e.moved?.minor ?? 0) : 0), 0));
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
  async boundOrderCustomer(orderId) {
    return entries.find((e) => e.tool === 'create_order' && e.outcome === 'executed' && e.detail === `Order ${orderId} bound to the task customer`)?.task.mandate.customerEmail;
  },
};

const judge: IntentJudge = {
  async judge({ call }) {
    judgeCalls++;
    judgedCalls.push(call);
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

// Subscriptions as PayPal's show_subscription_details returns them: the subscriber owns it.
const subscription = (id: string, email?: string) =>
  JSON.stringify({
    id,
    status: 'ACTIVE',
    plan_id: 'P-1',
    custom_id: 'shop-ref-9',
    ...(email && { subscriber: { email_address: email, name: { given_name: 'Someone' } } }),
    billing_info: { next_billing_time: '2026-11-21T10:00:00Z', outstanding_balance: { currency_code: 'USD', value: '0.0' } },
    links: [{ href: 'https://api.sandbox.paypal.com/v1/billing/subscriptions/x', rel: 'self' }],
  });
const SUBSCRIPTIONS: Record<string, string> = {
  'I-ANA': subscription('I-ANA', 'ana@example.com'),
  'I-BEN': subscription('I-BEN', 'ben@example.com'),
  'I-NOBODY': subscription('I-NOBODY'),
  'I-GARBLED': 'not json',
};

// Disputes as PayPal's get_dispute returns them: the customer's email is hidden from the shop, so
// the disputed capture (seller_transaction_id) is what says whose payment it was.
const disputeAnswer = (id: string, captureIds: string[]) =>
  JSON.stringify({
    dispute_id: id,
    status: 'WAITING_FOR_SELLER_RESPONSE',
    reason: 'MERCHANDISE_OR_SERVICE_NOT_RECEIVED',
    dispute_amount: { currency_code: 'USD', value: '20.00' },
    seller_response_due_date: '2026-11-03T10:00:00Z',
    disputed_transactions: captureIds.map((captureId) => ({
      seller_transaction_id: captureId,
      buyer_transaction_id: 'B-1',
      custom: 'ana@example.com',
      buyer: { name: 'Ana Buyer' },
      gross_amount: { currency_code: 'USD', value: '20.00' },
    })),
    messages: [{ posted_by: 'BUYER', content: 'Call me at ana@example.com' }],
    links: [{ href: 'https://api.sandbox.paypal.com/v1/customer/disputes/x', rel: 'self' }],
  });
const DISPUTES: Record<string, string> = {
  'PP-D-ANA': disputeAnswer('PP-D-ANA', ['CAP-ANA']),
  'PP-D-BEN': disputeAnswer('PP-D-BEN', ['CAP-BEN']),
  'PP-D-NONE': disputeAnswer('PP-D-NONE', []),
  'PP-D-GARBLED': 'not json',
};

// Invoices as PayPal's get_invoice returns them: the primary recipient is whom it bills.
const invoiceAnswer = (id: string, emails: string[], status = 'SENT') =>
  JSON.stringify({
    id,
    status,
    detail: { invoice_number: '0042', currency_code: 'USD', invoice_date: '2026-10-20', payment_term: { term_type: 'NET_10', due_date: '2026-10-30' } },
    invoicer: { email_address: 'shop@business.example.com' },
    primary_recipients: emails.map((email_address) => ({ billing_info: { email_address, name: { given_name: 'Someone' } } })),
    items: [{ name: 'Mug', quantity: '2', unit_amount: { currency_code: 'USD', value: '12.50' } }],
    amount: { currency_code: 'USD', value: '25.00' },
    due_amount: { currency_code: 'USD', value: '25.00' },
    links: [{ href: 'https://api.sandbox.paypal.com/v2/invoicing/invoices/x', rel: 'self' }],
  });
const INVOICES: Record<string, string> = {
  'INV2-ANA': invoiceAnswer('INV2-ANA', ['ana@example.com']),
  'INV2-BEN': invoiceAnswer('INV2-BEN', ['ben@example.com']),
  'INV2-BOTH': invoiceAnswer('INV2-BOTH', ['ana@example.com', 'ben@example.com']),
  'INV2-GARBLED': 'not json',
};

// The order PayPal's create_order answers with: CREATED, with the link the buyer approves it on.
const NEW_ORDER_ID = '5O190127TN364715T';
let createdOrderAnswer: string;
let rejectOrders: boolean;

// The invoice and order tools are registered only for their tests, so the support agent's tool list stays as it was.
function fakePayPal({ invoiceTools = false, orderTools = false } = {}) {
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
  server.registerTool('show_subscription_details', { description: 'show', inputSchema: { subscription_id: z.string() } }, async (args) => {
    upstreamCalls.push({ name: 'show_subscription_details', args });
    return { content: [{ type: 'text' as const, text: SUBSCRIPTIONS[args.subscription_id] ?? 'not found' }] };
  });
  server.registerTool(
    'cancel_subscription',
    { description: 'cancel', inputSchema: { subscription_id: z.string(), payload: z.object({ reason: z.string() }) } },
    ok('cancel_subscription'),
  );
  server.registerTool('get_dispute', { description: 'dispute', inputSchema: { dispute_id: z.string() } }, async (args) => {
    upstreamCalls.push({ name: 'get_dispute', args });
    return { content: [{ type: 'text' as const, text: DISPUTES[args.dispute_id] ?? 'not found' }] };
  });
  server.registerTool('accept_dispute_claim', { description: 'accept', inputSchema: { dispute_id: z.string(), note: z.string() } }, ok('accept_dispute_claim'));
  server.registerTool('update_shipment_tracking', { description: 'tracking', inputSchema: { id: z.string() } }, ok('update_shipment_tracking'));
  if (invoiceTools) {
    server.registerTool('get_invoice', { description: 'invoice', inputSchema: { invoice_id: z.string() } }, async (args) => {
      upstreamCalls.push({ name: 'get_invoice', args });
      return { content: [{ type: 'text' as const, text: INVOICES[args.invoice_id] ?? 'not found' }] };
    });
    const creation = {
      currency_code: z.string().optional(),
      invoice_number: z.string().optional(),
      primary_recipients: z.array(z.unknown()).optional(),
      items: z.array(z.unknown()).optional(),
      shipping_cost: z.string().optional(),
    };
    const sending = {
      invoice_id: z.string(),
      note: z.string().optional(),
      subject: z.string().optional(),
      send_to_recipient: z.boolean().optional(),
      additional_recipients: z.array(z.string()).optional(),
    };
    server.registerTool('create_invoice', { description: 'create invoice', inputSchema: creation }, ok('create_invoice'));
    server.registerTool('send_invoice', { description: 'send invoice', inputSchema: sending }, ok('send_invoice'));
    server.registerTool('send_invoice_reminder', { description: 'remind', inputSchema: sending }, ok('send_invoice_reminder'));
  }
  if (orderTools) {
    const creation = {
      currencyCode: z.string().optional(),
      items: z.array(z.unknown()).optional(),
      discount: z.number().optional(),
      shippingCost: z.number().optional(),
      returnUrl: z.string().optional(),
      cancelUrl: z.string().optional(),
    };
    server.registerTool('create_order', { description: 'create order', inputSchema: creation }, async (args) => {
      upstreamCalls.push({ name: 'create_order', args });
      if (rejectOrders) return { isError: true, content: [{ type: 'text' as const, text: 'UNPROCESSABLE_ENTITY' }] };
      return { content: [{ type: 'text' as const, text: createdOrderAnswer }] };
    });
  }
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
    subscriptions = undefined as SubscriptionLookup | undefined,
    disputes = undefined as DisputeLookup | undefined,
    invoices = undefined as InvoiceLookup | undefined,
    customers = undefined as CustomerDirectory | undefined,
    invoiceLimits = undefined as InvoiceLimits | undefined,
    invoiceTools = false,
    orders = undefined as OrderDeps | undefined,
    orderTools = false,
  } = {},
) {
  const [upClient, upServer] = InMemoryTransport.createLinkedPair();
  await fakePayPal({ invoiceTools, orderTools }).connect(upServer);
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
    subscriptions,
    disputes,
    invoices,
    customers,
    invoiceLimits,
    orders,
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
  judgedCalls = [];
  auditFails = false;
  auditUpdateFails = false;
  rejectRefunds = false;
  approvalThreshold = usd(10000);
  rejectOrders = false;
  createdOrderAnswer = JSON.stringify({ id: NEW_ORDER_ID, status: 'CREATED', links: [{ rel: 'payer-action', href: `https://www.sandbox.paypal.com/checkoutnow?token=${NEW_ORDER_ID}` }] });
  delete ORDERS[NEW_ORDER_ID];
});

describe('payment guard', () => {
  it('exposes the upstream PayPal tools unchanged', async () => {
    const agent = await connect();
    const { tools } = await agent.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual([
      'accept_dispute_claim',
      'cancel_subscription',
      'create_refund',
      'get_dispute',
      'get_order',
      'get_refund',
      'list_transactions',
      'show_subscription_details',
      'update_shipment_tracking',
    ]);
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
    expect(judgedCalls).toEqual([{ tool: 'create_refund', args }]);
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
    expect(text(result)).toBe(
      'Refund held for human approval; it has not been executed. Tell the customer a person will review it. APPROVAL_REQUIRED: Refund 25.00 USD is over the approval threshold 20.00 USD',
    );
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
    const result = await agent.callTool({ name: 'update_shipment_tracking', arguments: { id: 'T-1' } });
    expect(result.isError).toBe(true);
    expect(text(result)).toContain('TOOL_NOT_ALLOWED');
    expect(upstreamCalls).toEqual([]);
    expect(entries[0]).toMatchObject({ tool: 'update_shipment_tracking', outcome: 'blocked', decision: { verdict: 'block' } });
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

describe('subscription reads', () => {
  it('returns a subscription of the ticket customer without its personal data, and logs the read', async () => {
    const agent = await connect();
    const result = await agent.callTool({ name: 'show_subscription_details', arguments: { subscription_id: 'I-ANA' } });
    expect(result.isError).toBeFalsy();
    expect(JSON.parse(text(result))).toEqual({
      id: 'I-ANA',
      status: 'ACTIVE',
      plan_id: 'P-1',
      billing_info: { next_billing_time: '2026-11-21T10:00:00Z' },
      withheld_by_guard: ['custom_id', 'subscriber', 'billing_info.outstanding_balance', 'links'],
    });
    expect(text(result)).not.toContain('ana@example.com');
    expect(upstreamCalls).toEqual([{ name: 'show_subscription_details', args: { subscription_id: 'I-ANA' } }]);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      tool: 'show_subscription_details',
      outcome: 'executed',
      decision: { verdict: 'allow', violations: [] },
      detail: 'Withheld from the agent: custom_id, subscriber, billing_info.outstanding_balance, links',
    });
    expect(entries[0].moved).toBeUndefined();
    expect(judgeCalls).toBe(0);
  });

  it("withholds another customer's subscription and logs the read as blocked", async () => {
    const agent = await connect();
    const result = await agent.callTool({ name: 'show_subscription_details', arguments: { subscription_id: 'I-BEN' } });
    expect(result.isError).toBe(true);
    expect(text(result)).toContain('CUSTOMER_MISMATCH');
    expect(text(result)).not.toContain('ben@example.com');
    expect(text(result)).not.toContain('I-BEN');
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ tool: 'show_subscription_details', outcome: 'blocked', decision: { verdict: 'block', violations: [{ code: 'CUSTOMER_MISMATCH' }] } });
    expect(judgeCalls).toBe(0);
  });

  it('refuses a subscription id that is not a plain id before PayPal is called, since the toolkit pastes it into the URL', async () => {
    const agent = await connect();
    for (const subscription_id of ['../plans/P-1', 'I-ANA?x=1', '']) {
      const result = await agent.callTool({ name: 'show_subscription_details', arguments: { subscription_id } });
      expect(result.isError).toBe(true);
      expect(text(result)).toContain('INVALID_ARGUMENTS');
    }
    expect(upstreamCalls).toEqual([]);
    expect(entries.map((e) => e.outcome)).toEqual(['blocked', 'blocked', 'blocked']);
  });

  it('withholds a subscription whose owner is missing or cannot be read from the PayPal answer', async () => {
    const agent = await connect();
    for (const id of ['I-NOBODY', 'I-GARBLED']) {
      const result = await agent.callTool({ name: 'show_subscription_details', arguments: { subscription_id: id } });
      expect(result.isError).toBe(true);
      expect(text(result)).toContain('CUSTOMER_MISMATCH');
      expect(text(result)).not.toContain('not json');
    }
    expect(entries.map((e) => e.outcome)).toEqual(['blocked', 'blocked']);
  });
});

describe('subscription cancellation', () => {
  let subscriptionFacts: SubscriptionFacts | undefined;
  let lookups: string[];
  const subscriptions: SubscriptionLookup = {
    async getSubscription(id) {
      lookups.push(id);
      return subscriptionFacts && { ...subscriptionFacts, id };
    },
  };
  const cancel = { subscription_id: 'I-ANA', payload: { reason: 'Customer asked to cancel' } };

  beforeEach(() => {
    subscriptionFacts = { id: 'I-ANA', status: 'ACTIVE', customerEmail: 'ana@example.com' };
    lookups = [];
  });

  it('forwards a cancellation that passes the checks and the judge, moving no money', async () => {
    const agent = await connect(undefined, { subscriptions });
    const result = await agent.callTool({ name: 'cancel_subscription', arguments: cancel });
    expect(result.isError).toBeFalsy();
    expect(text(result)).toBe('cancel_subscription ok');
    expect(lookups).toEqual(['I-ANA']);
    expect(judgedCalls).toEqual([{ tool: 'cancel_subscription', args: cancel }]);
    expect(upstreamCalls).toEqual([{ name: 'cancel_subscription', args: cancel }]);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ tool: 'cancel_subscription', args: cancel, outcome: 'executed', decision: { verdict: 'allow', violations: [] } });
    expect(entries[0].moved).toBeUndefined();
  });

  it('blocks a cancellation with malformed arguments without looking it up, judging it or reaching PayPal', async () => {
    const agent = await connect(undefined, { subscriptions });
    const malformed = [
      {},
      { payload: { reason: 'x' } },
      { subscription_id: '', payload: { reason: 'x' } },
      { subscription_id: '../../v2/checkout/orders/X', payload: { reason: 'x' } },
      { subscription_id: 42, payload: { reason: 'x' } },
      { subscription_id: 'I-ANA' },
      { subscription_id: 'I-ANA', payload: 'x' },
      { subscription_id: 'I-ANA', payload: { reason: '' } },
      { subscription_id: 'I-ANA', payload: { reason: '   ' } },
      { subscription_id: 'I-ANA', payload: { reason: 'x'.repeat(129) } },
    ];
    for (const args of malformed) {
      const result = await agent.callTool({ name: 'cancel_subscription', arguments: args });
      expect(result.isError).toBe(true);
      expect(text(result)).toContain('INVALID_ARGUMENTS');
    }
    expect(entries).toHaveLength(malformed.length);
    for (const entry of entries) expect(entry).toMatchObject({ tool: 'cancel_subscription', outcome: 'blocked', decision: { verdict: 'block', violations: [{ code: 'INVALID_ARGUMENTS' }] } });
    expect(lookups).toEqual([]);
    expect(judgeCalls).toBe(0);
    expect(upstreamCalls).toEqual([]);
  });

  it('accepts a reason of exactly 128 characters', async () => {
    const agent = await connect(undefined, { subscriptions });
    const result = await agent.callTool({ name: 'cancel_subscription', arguments: { subscription_id: 'I-ANA', payload: { reason: 'x'.repeat(128) } } });
    expect(result.isError).toBeFalsy();
    expect(entries[0]).toMatchObject({ outcome: 'executed' });
  });

  it('fails closed when the subscription cannot be looked up, is unknown, or the lookup hangs', async () => {
    const failing: SubscriptionLookup[] = [
      { getSubscription: async () => { throw new Error('PayPal 500'); } },
      { getSubscription: async () => undefined },
      { getSubscription: () => new Promise(() => undefined) },
    ];
    for (const lookup of failing) {
      entries = [];
      const agent = await connect(undefined, { subscriptions: lookup });
      const result = await agent.callTool({ name: 'cancel_subscription', arguments: cancel });
      expect(result.isError).toBe(true);
      expect(text(result)).toContain('SUBSCRIPTION_LOOKUP_FAILED');
      expect(entries).toHaveLength(1);
      expect(entries[0]).toMatchObject({ tool: 'cancel_subscription', outcome: 'blocked', decision: { verdict: 'block', violations: [{ code: 'SUBSCRIPTION_LOOKUP_FAILED' }] } });
    }
    expect(judgeCalls).toBe(0);
    expect(upstreamCalls).toEqual([]);
  });

  it('fails closed when the guard has no subscription lookup at all', async () => {
    const agent = await connect();
    const result = await agent.callTool({ name: 'cancel_subscription', arguments: cancel });
    expect(result.isError).toBe(true);
    expect(text(result)).toContain('SUBSCRIPTION_LOOKUP_FAILED');
    expect(entries[0]).toMatchObject({ outcome: 'blocked' });
    expect(upstreamCalls).toEqual([]);
  });

  it("blocks cancelling another customer's subscription without asking the judge", async () => {
    subscriptionFacts = { id: 'I-ANA', status: 'ACTIVE', customerEmail: 'ben@example.com' };
    const agent = await connect(undefined, { subscriptions });
    const result = await agent.callTool({ name: 'cancel_subscription', arguments: cancel });
    expect(result.isError).toBe(true);
    expect(text(result)).toContain('CUSTOMER_MISMATCH');
    expect(text(result)).not.toContain('ben@example.com');
    expect(entries[0]).toMatchObject({ tool: 'cancel_subscription', outcome: 'blocked', decision: { verdict: 'block', violations: [{ code: 'CUSTOMER_MISMATCH' }] } });
    expect(judgeCalls).toBe(0);
    expect(upstreamCalls).toEqual([]);
  });

  it('blocks a subscription that is not active or suspended', async () => {
    subscriptionFacts = { id: 'I-ANA', status: 'CANCELLED', customerEmail: 'ana@example.com' };
    const agent = await connect(undefined, { subscriptions });
    const result = await agent.callTool({ name: 'cancel_subscription', arguments: cancel });
    expect(result.isError).toBe(true);
    expect(text(result)).toContain('SUBSCRIPTION_NOT_CANCELLABLE');
    expect(entries[0]).toMatchObject({ outcome: 'blocked', decision: { verdict: 'block', violations: [{ code: 'SUBSCRIPTION_NOT_CANCELLABLE' }] } });
    expect(judgeCalls).toBe(0);
    expect(upstreamCalls).toEqual([]);
  });

  it('cancels at most one subscription per ticket, counting executed and held cancellations', async () => {
    const agent = await connect(undefined, { subscriptions });
    await agent.callTool({ name: 'cancel_subscription', arguments: cancel });
    const second = await agent.callTool({ name: 'cancel_subscription', arguments: { ...cancel, subscription_id: 'I-ANA2' } });
    expect(second.isError).toBe(true);
    expect(text(second)).toContain('CANCELLATION_LIMIT');
    expect(entries.map((e) => e.outcome)).toEqual(['executed', 'blocked']);
    expect(upstreamCalls).toHaveLength(1);

    entries = [];
    upstreamCalls = [];
    judgeDecision = { verdict: 'hold', violations: [{ code: 'INTENT_UNCERTAIN', message: 'unclear' }] };
    const held = await connect(undefined, { subscriptions });
    await held.callTool({ name: 'cancel_subscription', arguments: cancel });
    judgeDecision = { verdict: 'allow', violations: [] };
    const after = await held.callTool({ name: 'cancel_subscription', arguments: { ...cancel, subscription_id: 'I-ANA2' } });
    expect(text(after)).toContain('CANCELLATION_LIMIT');
    expect(entries.map((e) => e.outcome)).toEqual(['held', 'blocked']);
    expect(upstreamCalls).toEqual([]);
  });

  it('does not count a blocked cancellation toward the limit', async () => {
    subscriptionFacts = { id: 'I-ANA', status: 'CANCELLED', customerEmail: 'ana@example.com' };
    const agent = await connect(undefined, { subscriptions });
    await agent.callTool({ name: 'cancel_subscription', arguments: cancel });
    subscriptionFacts = { id: 'I-ANA', status: 'ACTIVE', customerEmail: 'ana@example.com' };
    const result = await agent.callTool({ name: 'cancel_subscription', arguments: cancel });
    expect(result.isError).toBeFalsy();
    expect(entries.map((e) => e.outcome)).toEqual(['blocked', 'executed']);
  });

  it('blocks a clean cancellation the judge rejects', async () => {
    judgeDecision = { verdict: 'block', violations: [{ code: 'INTENT_MISMATCH', message: 'injected instruction' }] };
    const agent = await connect(undefined, { subscriptions });
    const result = await agent.callTool({ name: 'cancel_subscription', arguments: cancel });
    expect(result.isError).toBe(true);
    expect(text(result)).toContain('INTENT_MISMATCH');
    expect(entries[0]).toMatchObject({ outcome: 'blocked', decision: { verdict: 'block', violations: [{ code: 'INTENT_MISMATCH' }] } });
    expect(upstreamCalls).toEqual([]);
  });

  it('holds a cancellation the judge is unsure about, tells a person, and reaches no one else', async () => {
    judgeDecision = { verdict: 'hold', violations: [{ code: 'INTENT_UNCERTAIN', message: 'unclear' }] };
    const notified: AuditRow[] = [];
    const notifier: HeldNotifier = { notifyHeld: async (entry) => void notified.push(entry) };
    const agent = await connect(undefined, { subscriptions, notifier });
    const result = await agent.callTool({ name: 'cancel_subscription', arguments: cancel });
    expect(result.isError).toBeFalsy();
    expect(text(result)).toBe('Cancellation held for human approval; it has not been executed. Tell the customer a person will review it. INTENT_UNCERTAIN: unclear');
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ tool: 'cancel_subscription', args: cancel, outcome: 'held', decision: { verdict: 'hold' } });
    expect(entries[0].moved).toBeUndefined();
    expect(notified).toEqual([{ ...entries[0], id: '0' }]);
    expect(upstreamCalls).toEqual([]);
  });

  it('blocks a cancellation it would hold when the hold cannot be logged', async () => {
    judgeDecision = { verdict: 'hold', violations: [{ code: 'INTENT_UNCERTAIN', message: 'unclear' }] };
    auditFails = true;
    const agent = await connect(undefined, { subscriptions });
    const result = await agent.callTool({ name: 'cancel_subscription', arguments: cancel });
    expect(result.isError).toBe(true);
    expect(text(result)).toContain('AUDIT_UNAVAILABLE');
    expect(upstreamCalls).toEqual([]);
  });
});

describe('held cancellation approval', () => {
  let subscriptionFacts: SubscriptionFacts | undefined;
  const cancel = { subscription_id: 'I-ANA', payload: { reason: 'Customer asked to cancel' } };
  const hold = { verdict: 'hold' as const, violations: [{ code: 'INTENT_UNCERTAIN', message: 'unclear' }] };

  async function decide(heldId: string, approve: boolean, subscriptions: SubscriptionLookup = { getSubscription: async (id) => subscriptionFacts && { ...subscriptionFacts, id } }) {
    const [upClient, upServer] = InMemoryTransport.createLinkedPair();
    await fakePayPal().connect(upServer);
    const upstream = new Client({ name: 'approval-upstream', version: '0.0.0' });
    await upstream.connect(upClient);
    return decideHeldCall(
      {
        upstream,
        captures: { getCapture: async () => facts },
        subscriptions,
        audit,
        limits: { approvalThreshold: usd(2000), perRefund: usd(10000), daily: usd(20000) },
        now: () => new Date('2026-10-20T13:00:00Z'),
        timeoutMs: 50,
      },
      heldId,
      approve,
    );
  }

  beforeEach(() => {
    subscriptionFacts = { id: 'I-ANA', status: 'ACTIVE', customerEmail: 'ana@example.com' };
    entries.push({ at: '2026-10-20T12:00:00Z', tool: 'cancel_subscription', args: cancel, task, decision: hold, outcome: 'held' });
  });

  it('runs an approved cancellation through PayPal and records it against the held entry', async () => {
    const result = await decide('0', true);
    expect(result).toEqual({ outcome: 'executed', message: 'Subscription I-ANA cancelled in PayPal' });
    expect(upstreamCalls).toEqual([{ name: 'cancel_subscription', args: cancel }]);
    expect(entries[1]).toMatchObject({
      tool: 'cancel_subscription',
      args: cancel,
      task,
      resolves: '0',
      outcome: 'executed',
      decision: { verdict: 'allow', violations: [{ code: 'APPROVED_BY_PERSON' }] },
    });
    expect(entries[1].moved).toBeUndefined();
    expect((await decide('0', true)).outcome).toBe('refused');
    expect(upstreamCalls).toHaveLength(1);
  });

  it('checks the subscription again on approval and blocks a cancellation that no longer fits', async () => {
    subscriptionFacts = { id: 'I-ANA', status: 'CANCELLED', customerEmail: 'ana@example.com' };
    const result = await decide('0', true);
    expect(result.outcome).toBe('blocked');
    expect(result.message).toContain('SUBSCRIPTION_NOT_CANCELLABLE');
    expect(entries[1]).toMatchObject({ resolves: '0', outcome: 'blocked', decision: { verdict: 'block', violations: [{ code: 'SUBSCRIPTION_NOT_CANCELLABLE' }] } });
    expect(upstreamCalls).toEqual([]);
  });

  it('keeps the hold open when PayPal cannot be reached to re-check it, so it can be approved later', async () => {
    const unreachable = await decide('0', true, { getSubscription: async () => { throw new Error('connect timeout'); } });
    expect(unreachable.outcome).toBe('error');
    expect(unreachable.message).toContain('still held');
    expect(entries).toHaveLength(1);
    expect(upstreamCalls).toEqual([]);
    expect((await decide('0', true)).outcome).toBe('executed');
  });

  it('records a rejection without reaching PayPal, and the hold cannot be approved afterwards', async () => {
    const rejected = await decide('0', false);
    expect(rejected).toEqual({ outcome: 'blocked', message: 'Cancellation rejected; nothing was sent to PayPal' });
    expect(entries[1]).toMatchObject({ tool: 'cancel_subscription', resolves: '0', outcome: 'blocked', decision: { verdict: 'block', violations: [{ code: 'REJECTED_BY_PERSON' }] } });
    expect((await decide('0', true)).outcome).toBe('refused');
    expect(upstreamCalls).toEqual([]);
  });

  it('refuses a held entry of a tool the guard cannot decide', async () => {
    entries.push({ at: '2026-10-20T12:30:00Z', tool: 'update_shipment_tracking', args: { id: 'T-1' }, task, decision: hold, outcome: 'held' });
    expect((await decide('1', true)).outcome).toBe('refused');
    expect(entries).toHaveLength(2);
    expect(upstreamCalls).toEqual([]);
  });
});

// Captures by id, so a dispute can be about another customer's payment.
const capturesById: CaptureLookup = {
  async getCapture(captureId) {
    return { ...facts, captureId, captured: usd(2000), customerEmail: captureId === 'CAP-BEN' ? 'ben@example.com' : 'ana@example.com' };
  },
};

describe('dispute reads', () => {
  it('returns a dispute of the ticket customer without the messages or the buyer, and logs the read', async () => {
    const agent = await connect(capturesById);
    const result = await agent.callTool({ name: 'get_dispute', arguments: { dispute_id: 'PP-D-ANA' } });
    expect(result.isError).toBeFalsy();
    expect(JSON.parse(text(result))).toEqual({
      dispute_id: 'PP-D-ANA',
      status: 'WAITING_FOR_SELLER_RESPONSE',
      reason: 'MERCHANDISE_OR_SERVICE_NOT_RECEIVED',
      dispute_amount: { currency_code: 'USD', value: '20.00' },
      seller_response_due_date: '2026-11-03T10:00:00Z',
      disputed_transactions: [{ seller_transaction_id: 'CAP-ANA', gross_amount: { currency_code: 'USD', value: '20.00' } }],
      withheld_by_guard: [
        'disputed_transactions[0].buyer_transaction_id',
        'disputed_transactions[0].custom',
        'disputed_transactions[0].buyer',
        'messages',
        'links',
      ],
    });
    expect(text(result)).not.toContain('ana@example.com');
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ tool: 'get_dispute', outcome: 'executed', decision: { verdict: 'allow', violations: [] } });
    expect(entries[0].moved).toBeUndefined();
    expect(judgeCalls).toBe(0);
  });

  it("withholds a dispute about another customer's payment, or one whose payment can't be told", async () => {
    const agent = await connect(capturesById);
    for (const dispute_id of ['PP-D-BEN', 'PP-D-NONE', 'PP-D-GARBLED']) {
      const result = await agent.callTool({ name: 'get_dispute', arguments: { dispute_id } });
      expect(result.isError).toBe(true);
      expect(text(result)).toContain('CUSTOMER_MISMATCH');
      expect(text(result)).not.toContain('ben@example.com');
    }
    expect(entries.map((e) => e.outcome)).toEqual(['blocked', 'blocked', 'blocked']);
  });

  it('withholds a dispute when its capture cannot be looked up', async () => {
    const agent = await connect({ getCapture: async () => { throw new Error('connect timeout'); } });
    const result = await agent.callTool({ name: 'get_dispute', arguments: { dispute_id: 'PP-D-ANA' } });
    expect(result.isError).toBe(true);
    expect(text(result)).toContain('CUSTOMER_MISMATCH');
  });

  it('refuses a dispute id that is not a plain id before PayPal is called', async () => {
    const agent = await connect(capturesById);
    for (const dispute_id of ['../../v2/checkout/orders/X', 'PP-D-1?x=1', '']) {
      const result = await agent.callTool({ name: 'get_dispute', arguments: { dispute_id } });
      expect(text(result)).toContain('INVALID_ARGUMENTS: dispute_id must be a plain dispute id');
    }
    expect(upstreamCalls).toEqual([]);
  });
});

describe('dispute acceptance', () => {
  let disputeFacts: DisputeFacts | undefined;
  let lookups: string[];
  const disputes: DisputeLookup = {
    async getDispute(id) {
      lookups.push(id);
      return disputeFacts && { ...disputeFacts, id };
    },
  };
  const accept = { dispute_id: 'PP-D-ANA', note: 'Item_never_shipped' };
  const connectDisputes = (options: Parameters<typeof connect>[1] = {}) => connect(capturesById, { disputes, ...options });

  beforeEach(() => {
    disputeFacts = { id: 'PP-D-ANA', status: 'WAITING_FOR_SELLER_RESPONSE', amount: usd(2000), captureId: 'CAP-ANA' };
    lookups = [];
  });

  it('forwards an acceptance that passes the checks and the judge, counting the disputed amount as money out', async () => {
    const agent = await connectDisputes();
    const result = await agent.callTool({ name: 'accept_dispute_claim', arguments: accept });
    expect(result.isError).toBeFalsy();
    expect(text(result)).toBe('accept_dispute_claim ok');
    expect(lookups).toEqual(['PP-D-ANA']);
    expect(judgedCalls).toEqual([{ tool: 'accept_dispute_claim', args: accept }]);
    expect(upstreamCalls).toEqual([{ name: 'accept_dispute_claim', args: accept }]);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ tool: 'accept_dispute_claim', args: accept, outcome: 'executed', moved: usd(2000), decision: { verdict: 'allow' } });
  });

  it('blocks malformed arguments, or a note the toolkit would refuse, without looking up, judging or reaching PayPal', async () => {
    const agent = await connectDisputes();
    for (const args of [{ note: 'ok' }, { dispute_id: '../x', note: 'ok' }, { dispute_id: 'PP-D-ANA' }, { dispute_id: 'PP-D-ANA', note: 'Item never shipped' }]) {
      const result = await agent.callTool({ name: 'accept_dispute_claim', arguments: args });
      expect(text(result)).toContain('INVALID_ARGUMENTS');
    }
    expect(lookups).toEqual([]);
    expect(judgeCalls).toBe(0);
    expect(upstreamCalls).toEqual([]);
  });

  it('fails closed when the dispute is unknown, cannot be looked up, or there is no dispute lookup', async () => {
    disputeFacts = undefined;
    let result = await (await connectDisputes()).callTool({ name: 'accept_dispute_claim', arguments: accept });
    expect(text(result)).toContain('DISPUTE_LOOKUP_FAILED');
    const failing: DisputeLookup = { getDispute: async () => { throw new Error('PayPal 500 for ana@example.com'); } };
    result = await (await connect(capturesById, { disputes: failing })).callTool({ name: 'accept_dispute_claim', arguments: accept });
    expect(text(result)).toContain('DISPUTE_LOOKUP_FAILED');
    expect(text(result)).not.toContain('ana@example.com');
    result = await (await connect(capturesById)).callTool({ name: 'accept_dispute_claim', arguments: accept });
    expect(text(result)).toContain('DISPUTE_LOOKUP_FAILED: No dispute lookup is configured');
    expect(upstreamCalls).toEqual([]);
    expect(judgeCalls).toBe(0);
  });

  it("blocks accepting a claim on another customer's payment without asking the judge", async () => {
    disputeFacts = { ...disputeFacts!, captureId: 'CAP-BEN' };
    const result = await (await connectDisputes()).callTool({ name: 'accept_dispute_claim', arguments: accept });
    expect(text(result)).toContain('CUSTOMER_MISMATCH');
    expect(judgeCalls).toBe(0);
    expect(upstreamCalls).toEqual([]);
    expect(entries[0]).toMatchObject({ outcome: 'blocked' });
    expect(entries[0].moved).toBeUndefined();
  });

  it('blocks a dispute naming no single capture, and one the shop can no longer answer', async () => {
    disputeFacts = { ...disputeFacts!, captureId: null };
    expect(text(await (await connectDisputes()).callTool({ name: 'accept_dispute_claim', arguments: accept }))).toContain('CAPTURE_MISMATCH');
    disputeFacts = { ...disputeFacts, captureId: 'CAP-ANA', status: 'RESOLVED' };
    expect(text(await (await connectDisputes()).callTool({ name: 'accept_dispute_claim', arguments: accept }))).toContain('DISPUTE_NOT_ACCEPTABLE');
    expect(upstreamCalls).toEqual([]);
  });

  it('blocks accepting a claim while a refund of the same capture is unconfirmed, which could pay twice', async () => {
    entries.push({ at: '2026-10-20T11:00:00Z', tool: 'create_refund', args: { capture_id: 'CAP-ANA' }, task, decision: { verdict: 'allow', violations: [] }, outcome: 'pending', moved: usd(2000) });
    const result = await (await connectDisputes()).callTool({ name: 'accept_dispute_claim', arguments: accept });
    expect(text(result)).toContain('REFUND_UNCONFIRMED');
    expect(upstreamCalls).toEqual([]);
  });

  it('holds a clean acceptance over the approval threshold, without reaching PayPal or counting it', async () => {
    approvalThreshold = usd(1000);
    const notified: AuditRow[] = [];
    const agent = await connectDisputes({ notifier: { notifyHeld: async (entry) => void notified.push(entry) } });
    const result = await agent.callTool({ name: 'accept_dispute_claim', arguments: accept });
    expect(result.isError).toBeFalsy();
    expect(text(result)).toContain('Dispute acceptance held for human approval');
    expect(text(result)).toContain('APPROVAL_REQUIRED');
    expect(upstreamCalls).toEqual([]);
    expect(entries[0]).toMatchObject({ tool: 'accept_dispute_claim', outcome: 'held' });
    expect(entries[0].moved).toBeUndefined();
    expect(notified).toHaveLength(1);
  });

  it('blocks a clean acceptance the judge rejects', async () => {
    judgeDecision = { verdict: 'block', violations: [{ code: 'INTENT_MISMATCH', message: 'The customer did not ask for this' }] };
    const result = await (await connectDisputes()).callTool({ name: 'accept_dispute_claim', arguments: accept });
    expect(text(result)).toContain('INTENT_MISMATCH');
    expect(upstreamCalls).toEqual([]);
  });
});

describe('held dispute acceptance approval', () => {
  let disputeFacts: DisputeFacts | undefined;
  const accept = { dispute_id: 'PP-D-ANA', note: 'Item_never_shipped' };
  const hold = { verdict: 'hold' as const, violations: [{ code: 'APPROVAL_REQUIRED', message: 'over threshold' }] };

  async function decide(heldId: string, approve: boolean, disputes: DisputeLookup = { getDispute: async (id) => disputeFacts && { ...disputeFacts, id } }) {
    const [upClient, upServer] = InMemoryTransport.createLinkedPair();
    await fakePayPal().connect(upServer);
    const upstream = new Client({ name: 'approval-upstream', version: '0.0.0' });
    await upstream.connect(upClient);
    return decideHeldCall(
      {
        upstream,
        captures: capturesById,
        disputes,
        audit,
        limits: { approvalThreshold: usd(1000), perRefund: usd(10000), daily: usd(20000) },
        now: () => new Date('2026-10-20T13:00:00Z'),
        timeoutMs: 50,
      },
      heldId,
      approve,
    );
  }

  beforeEach(() => {
    disputeFacts = { id: 'PP-D-ANA', status: 'WAITING_FOR_SELLER_RESPONSE', amount: usd(2000), captureId: 'CAP-ANA' };
    entries.push({ at: '2026-10-20T12:00:00Z', tool: 'accept_dispute_claim', args: accept, task, decision: hold, outcome: 'held' });
  });

  it('runs an approved acceptance through PayPal, lifting only the approval threshold, and records the amount', async () => {
    const result = await decide('0', true);
    expect(result).toEqual({ outcome: 'executed', message: 'Dispute PP-D-ANA accepted in PayPal; it refunds 20.00 USD' });
    expect(upstreamCalls).toEqual([{ name: 'accept_dispute_claim', args: accept }]);
    expect(entries[1]).toMatchObject({ resolves: '0', outcome: 'executed', moved: usd(2000), decision: { violations: [{ code: 'APPROVED_BY_PERSON' }] } });
  });

  it('checks the dispute again on approval and blocks one that no longer fits', async () => {
    disputeFacts = { ...disputeFacts!, status: 'RESOLVED' };
    const result = await decide('0', true);
    expect(result.outcome).toBe('blocked');
    expect(result.message).toContain('DISPUTE_NOT_ACCEPTABLE');
    expect(upstreamCalls).toEqual([]);
  });

  it('keeps the hold open when PayPal cannot be reached to re-check it', async () => {
    const unreachable = await decide('0', true, { getDispute: async () => { throw new Error('connect timeout'); } });
    expect(unreachable).toEqual({ outcome: 'error', message: 'PayPal could not be reached to check the dispute; the dispute acceptance is still held, try again' });
    expect(entries).toHaveLength(1);
    expect((await decide('0', true)).outcome).toBe('executed');
  });

  it('records a rejection without reaching PayPal', async () => {
    expect(await decide('0', false)).toEqual({ outcome: 'blocked', message: 'Dispute acceptance rejected; nothing was sent to PayPal' });
    expect(upstreamCalls).toEqual([]);
  });
});

describe('refunds next to invoices', () => {
  it('keeps invoices out of the refund daily limit: money billed is not money refunded', async () => {
    entries.push({ at: '2026-10-20T11:00:00Z', tool: 'create_invoice', args: {}, task, decision: { verdict: 'allow', violations: [] }, outcome: 'executed', moved: usd(19000) });
    const agent = await connect();
    const result = await agent.callTool({ name: 'create_refund', arguments: { capture_id: 'CAP-1', amount: { currency_code: 'USD', value: '50.00' } } });
    expect(result.isError).toBeFalsy();
    expect(entries[1]).toMatchObject({ tool: 'create_refund', outcome: 'executed', moved: usd(5000) });
  });
});

// create_invoice's flat arguments, billing ana 2 x 12.50 USD.
const invoiceArgs = (overrides: Record<string, unknown> = {}) => ({
  currency_code: 'USD',
  invoice_number: '0042',
  primary_recipients: [{ billing_info: { email_address: 'ana@example.com' } }],
  items: [{ name: 'Mug', quantity: '2', unit_amount: { currency_code: 'USD', value: '12.50' } }],
  ...overrides,
});
const invoiceOf = (value: string) => invoiceArgs({ items: [{ name: 'Mug', quantity: '1', unit_amount: { currency_code: 'USD', value } }] });
const invoiceLimits: InvoiceLimits = { approvalThreshold: usd(10000), perInvoice: usd(50000), daily: usd(100000) };

describe('invoice creation', () => {
  let known: string[];
  let directoryCalls: string[];
  const customers: CustomerDirectory = {
    async isCustomer(email) {
      directoryCalls.push(email);
      return known.includes(email);
    },
  };
  const connectInvoices = (options: Parameters<typeof connect>[1] = {}) => connect(undefined, { customers, invoiceLimits, invoiceTools: true, ...options });

  beforeEach(() => {
    known = ['ana@example.com', 'ben@example.com', 'carla@example.com'];
    directoryCalls = [];
  });

  it('forwards an invoice that passes the checks and the judge, recording its total as the amount billed', async () => {
    const agent = await connectInvoices();
    const result = await agent.callTool({ name: 'create_invoice', arguments: invoiceArgs() });
    expect(result.isError).toBeFalsy();
    expect(text(result)).toBe('create_invoice ok');
    expect(directoryCalls).toEqual(['ana@example.com']);
    expect(judgedCalls).toEqual([{ tool: 'create_invoice', args: invoiceArgs() }]);
    expect(upstreamCalls).toEqual([{ name: 'create_invoice', args: invoiceArgs() }]);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ tool: 'create_invoice', outcome: 'executed', moved: usd(2500), decision: { verdict: 'allow', violations: [] } });
  });

  it('blocks malformed invoices without asking the directory, the judge or PayPal', async () => {
    const agent = await connectInvoices();
    const malformed = [
      invoiceArgs({ primary_recipients: [] }),
      invoiceArgs({ primary_recipients: [{ billing_info: { email_address: 'ana@example.com' } }, { billing_info: { email_address: 'ben@example.com' } }] }),
      invoiceArgs({ items: [] }),
      invoiceArgs({ items: [{ name: 'Mug', quantity: '1', unit_amount: { currency_code: 'USD', value: '-10.00' } }] }),
      invoiceArgs({ items: [{ name: 'Mug', quantity: '-1', unit_amount: { currency_code: 'USD', value: '10.00' } }] }),
      invoiceArgs({ items: [{ name: 'Mug', quantity: '1', unit_amount: { currency_code: 'EUR', value: '10.00' } }] }),
      invoiceArgs({ shipping_cost: '-5.00' }),
      invoiceOf('0.00'),
    ];
    for (const args of malformed) {
      const result = await agent.callTool({ name: 'create_invoice', arguments: args });
      expect(result.isError).toBe(true);
      expect(text(result)).toContain('INVALID_ARGUMENTS');
    }
    expect(entries.map((e) => e.outcome)).toEqual(malformed.map(() => 'blocked'));
    expect(entries.every((e) => e.moved === undefined)).toBe(true);
    expect(directoryCalls).toEqual([]);
    expect(judgeCalls).toBe(0);
    expect(upstreamCalls).toEqual([]);
  });

  it('blocks billing anyone but the task customer, without asking the judge', async () => {
    const result = await (await connectInvoices()).callTool({ name: 'create_invoice', arguments: invoiceArgs({ primary_recipients: [{ billing_info: { email_address: 'ben@example.com' } }] }) });
    expect(text(result)).toBe('Blocked by payment guard. CUSTOMER_MISMATCH: Invoice recipient is not the task customer ana@example.com');
    expect(judgeCalls).toBe(0);
    expect(upstreamCalls).toEqual([]);
    expect(entries[0]).toMatchObject({ tool: 'create_invoice', outcome: 'blocked' });
    expect(entries[0].moved).toBeUndefined();
  });

  it('blocks billing a task customer the shop does not have', async () => {
    known = ['ben@example.com'];
    const result = await (await connectInvoices()).callTool({ name: 'create_invoice', arguments: invoiceArgs() });
    expect(text(result)).toBe('Blocked by payment guard. UNKNOWN_CUSTOMER: ana@example.com is not an existing customer of the shop');
    expect(judgeCalls).toBe(0);
    expect(upstreamCalls).toEqual([]);
  });

  it('fails closed when the customer directory fails, hangs, or is not configured', async () => {
    const failing: CustomerDirectory = { isCustomer: async () => { throw new Error('seed file locked by ana@example.com'); } };
    let result = await (await connectInvoices({ customers: failing })).callTool({ name: 'create_invoice', arguments: invoiceArgs() });
    expect(text(result)).toContain('CUSTOMER_LOOKUP_FAILED');
    expect(text(result)).not.toContain('ana@example.com');
    const hanging: CustomerDirectory = { isCustomer: () => new Promise(() => undefined) };
    result = await (await connectInvoices({ customers: hanging })).callTool({ name: 'create_invoice', arguments: invoiceArgs() });
    expect(text(result)).toContain('CUSTOMER_LOOKUP_FAILED: Customer lookup timed out');
    result = await (await connect(undefined, { invoiceTools: true })).callTool({ name: 'create_invoice', arguments: invoiceArgs() });
    expect(text(result)).toBe('Blocked by payment guard. CUSTOMER_LOOKUP_FAILED: No customer directory is configured');
    expect(judgeCalls).toBe(0);
    expect(upstreamCalls).toEqual([]);
  });

  it('blocks an invoice over the per-invoice limit, without asking for approval', async () => {
    const result = await (await connectInvoices()).callTool({ name: 'create_invoice', arguments: invoiceOf('500.01') });
    expect(text(result)).toBe('Blocked by payment guard. INVOICE_LIMIT: Invoice 500.01 USD is over the per-invoice limit 500.00 USD');
    expect(upstreamCalls).toEqual([]);
  });

  it('caps what invoices bill per day, counting invoices billed today but not refunds', async () => {
    entries.push({ at: '2026-10-20T09:00:00Z', tool: 'create_refund', args: { capture_id: 'CAP-9' }, task, decision: { verdict: 'allow', violations: [] }, outcome: 'executed', moved: usd(90000) });
    const agent = await connectInvoices({ invoiceLimits: { ...invoiceLimits, approvalThreshold: usd(50000) } });
    expect((await agent.callTool({ name: 'create_invoice', arguments: invoiceOf('500.00') })).isError).toBeFalsy();
    expect((await agent.callTool({ name: 'create_invoice', arguments: invoiceOf('400.00') })).isError).toBeFalsy();
    const third = await agent.callTool({ name: 'create_invoice', arguments: invoiceOf('100.01') });
    expect(text(third)).toBe('Blocked by payment guard. DAILY_LIMIT: Invoices today would reach 1000.01 USD, over 1000.00 USD');
    expect(entries.map((e) => e.outcome)).toEqual(['executed', 'executed', 'executed', 'blocked']);
    expect(upstreamCalls).toHaveLength(2);
  });

  it('holds a clean invoice over the approval threshold, tells a person, and bills nothing yet', async () => {
    const notified: AuditRow[] = [];
    const agent = await connectInvoices({ notifier: { notifyHeld: async (entry) => void notified.push(entry) } });
    const result = await agent.callTool({ name: 'create_invoice', arguments: invoiceOf('120.00') });
    expect(result.isError).toBeFalsy();
    expect(text(result)).toContain('Invoice held for human approval; it has not been executed.');
    expect(text(result)).toContain('APPROVAL_REQUIRED: Invoice 120.00 USD is over the approval threshold 100.00 USD');
    expect(judgeCalls).toBe(1);
    expect(upstreamCalls).toEqual([]);
    expect(entries[0]).toMatchObject({ tool: 'create_invoice', outcome: 'held' });
    expect(entries[0].moved).toBeUndefined();
    expect(notified).toHaveLength(1);
  });

  it('blocks a clean invoice the judge rejects', async () => {
    judgeDecision = { verdict: 'block', violations: [{ code: 'INTENT_MISMATCH', message: 'Nobody asked to bill this' }] };
    const result = await (await connectInvoices()).callTool({ name: 'create_invoice', arguments: invoiceArgs() });
    expect(text(result)).toContain('INTENT_MISMATCH');
    expect(upstreamCalls).toEqual([]);
    expect(entries[0]).toMatchObject({ outcome: 'blocked' });
  });

  it('uses the default invoice limits when none are given', async () => {
    const agent = await connect(undefined, { customers, invoiceTools: true });
    expect(text(await agent.callTool({ name: 'create_invoice', arguments: invoiceOf('100.01') }))).toContain('APPROVAL_REQUIRED');
    expect(text(await agent.callTool({ name: 'create_invoice', arguments: invoiceOf('500.01') }))).toContain('INVOICE_LIMIT');
  });
});

describe('held invoice approval', () => {
  let directory: CustomerDirectory;
  const held = invoiceOf('120.00');
  const hold = { verdict: 'hold' as const, violations: [{ code: 'APPROVAL_REQUIRED', message: 'over threshold' }] };

  async function decide(heldId: string, approve: boolean, customers: CustomerDirectory | undefined = directory) {
    const [upClient, upServer] = InMemoryTransport.createLinkedPair();
    await fakePayPal({ invoiceTools: true }).connect(upServer);
    const upstream = new Client({ name: 'approval-upstream', version: '0.0.0' });
    await upstream.connect(upClient);
    return decideHeldCall(
      {
        upstream,
        captures: { getCapture: async () => facts },
        customers,
        audit,
        limits: { approvalThreshold: usd(1000), perRefund: usd(10000), daily: usd(20000) },
        invoiceLimits,
        now: () => new Date('2026-10-20T13:00:00Z'),
        timeoutMs: 50,
      },
      heldId,
      approve,
    );
  }

  beforeEach(() => {
    directory = { isCustomer: async (email) => email === 'ana@example.com' };
    entries.push({ at: '2026-10-20T12:00:00Z', tool: 'create_invoice', args: held, task, decision: hold, outcome: 'held' });
  });

  it('creates an approved invoice in PayPal, lifting only the approval threshold, and records the amount billed', async () => {
    expect(await decide('0', true)).toEqual({ outcome: 'executed', message: 'Invoice 0042 created in PayPal for 120.00 USD' });
    expect(upstreamCalls).toEqual([{ name: 'create_invoice', args: held }]);
    expect(entries[1]).toMatchObject({ tool: 'create_invoice', resolves: '0', outcome: 'executed', moved: usd(12000), decision: { verdict: 'allow', violations: [{ code: 'APPROVED_BY_PERSON' }] } });
    expect((await decide('0', true)).outcome).toBe('refused');
  });

  it('leaves the invoice number out of the message when the invoice has none', async () => {
    const unnumbered: Record<string, unknown> = { ...held };
    delete unnumbered.invoice_number;
    entries[0] = { ...entries[0], args: unnumbered };
    expect(await decide('0', true)).toEqual({ outcome: 'executed', message: 'Invoice created in PayPal for 120.00 USD' });
  });

  it('checks the invoice again on approval: the daily cap counts what was billed since the hold', async () => {
    entries.push({ at: '2026-10-20T12:30:00Z', tool: 'create_invoice', args: invoiceOf('900.00'), task, decision: { verdict: 'allow', violations: [] }, outcome: 'executed', moved: usd(90000) });
    const result = await decide('0', true);
    expect(result.outcome).toBe('blocked');
    expect(result.message).toContain('DAILY_LIMIT');
    expect(entries[2]).toMatchObject({ resolves: '0', outcome: 'blocked' });
    expect(upstreamCalls).toEqual([]);
  });

  it('keeps the hold open when the customer directory cannot be read', async () => {
    const unreachable = await decide('0', true, { isCustomer: async () => { throw new Error('locked'); } });
    expect(unreachable).toEqual({ outcome: 'error', message: 'The customer directory could not be reached to check the customer; the invoice is still held, try again' });
    expect(entries).toHaveLength(1);
    expect((await decide('0', true)).outcome).toBe('executed');
  });

  it('records a rejection without reaching PayPal', async () => {
    expect(await decide('0', false)).toEqual({ outcome: 'blocked', message: 'Invoice rejected; nothing was sent to PayPal' });
    expect(entries[1]).toMatchObject({ tool: 'create_invoice', resolves: '0', outcome: 'blocked', decision: { violations: [{ code: 'REJECTED_BY_PERSON' }] } });
    expect(upstreamCalls).toEqual([]);
  });
});

describe('invoice sending and reminders', () => {
  let invoiceFacts: InvoiceFacts | undefined;
  let lookups: string[];
  const invoices: InvoiceLookup = {
    async getInvoice(id) {
      lookups.push(id);
      return invoiceFacts && { ...invoiceFacts, id };
    },
  };
  const send = { invoice_id: 'INV2-ANA', note: 'Thanks' };
  const remind = { invoice_id: 'INV2-ANA', subject: 'Reminder' };
  const connectInvoices = (options: Parameters<typeof connect>[1] = {}) => connect(undefined, { invoices, invoiceTools: true, ...options });

  beforeEach(() => {
    invoiceFacts = { id: 'INV2-ANA', status: 'DRAFT', amount: usd(2500), recipientEmails: ['ana@example.com'] };
    lookups = [];
  });

  it('sends a draft invoice of the task customer after the judge, moving no money', async () => {
    const result = await (await connectInvoices()).callTool({ name: 'send_invoice', arguments: send });
    expect(result.isError).toBeFalsy();
    expect(text(result)).toBe('send_invoice ok');
    expect(lookups).toEqual(['INV2-ANA']);
    expect(judgedCalls).toEqual([{ tool: 'send_invoice', args: send }]);
    expect(upstreamCalls).toEqual([{ name: 'send_invoice', args: send }]);
    expect(entries[0]).toMatchObject({ tool: 'send_invoice', outcome: 'executed', decision: { verdict: 'allow' } });
    expect(entries[0].moved).toBeUndefined();
  });

  it('blocks a non-plain id, or sending to anyone but the invoice recipient, without looking it up', async () => {
    const agent = await connectInvoices();
    const cases: [string, Record<string, unknown>, string][] = [
      ['send_invoice', { invoice_id: '../v2/x' }, 'INVALID_ARGUMENTS: send_invoice needs a plain invoice_id'],
      ['send_invoice', { ...send, additional_recipients: ['mallory@example.com'] }, "INVALID_ARGUMENTS: send_invoice may send only to the invoice's own recipient: additional_recipients must be empty"],
      ['send_invoice', { ...send, send_to_recipient: false }, "INVALID_ARGUMENTS: send_invoice may send only to the invoice's own recipient: send_to_recipient cannot be false"],
      ['send_invoice_reminder', { ...remind, additional_recipients: ['mallory@example.com'] }, "INVALID_ARGUMENTS: send_invoice_reminder may send only to the invoice's own recipient"],
    ];
    for (const [name, args, expected] of cases) {
      expect(text(await agent.callTool({ name, arguments: args }))).toContain(expected);
    }
    expect(entries.map((e) => e.outcome)).toEqual(['blocked', 'blocked', 'blocked', 'blocked']);
    expect(lookups).toEqual([]);
    expect(judgeCalls).toBe(0);
    expect(upstreamCalls).toEqual([]);
  });

  it('fails closed when the invoice is unknown, cannot be looked up, or there is no invoice lookup', async () => {
    invoiceFacts = undefined;
    let result = await (await connectInvoices()).callTool({ name: 'send_invoice', arguments: send });
    expect(text(result)).toBe('Blocked by payment guard. INVOICE_LOOKUP_FAILED: Invoice INV2-ANA was not found in PayPal');
    const failing: InvoiceLookup = { getInvoice: async () => { throw new Error('PayPal 500 for ana@example.com'); } };
    result = await (await connectInvoices({ invoices: failing })).callTool({ name: 'send_invoice_reminder', arguments: remind });
    expect(text(result)).toContain('INVOICE_LOOKUP_FAILED');
    expect(text(result)).not.toContain('ana@example.com');
    result = await (await connect(undefined, { invoiceTools: true })).callTool({ name: 'send_invoice', arguments: send });
    expect(text(result)).toBe('Blocked by payment guard. INVOICE_LOOKUP_FAILED: No invoice lookup is configured');
    expect(judgeCalls).toBe(0);
    expect(upstreamCalls).toEqual([]);
  });

  it("blocks sending another customer's invoice, or one billing several people", async () => {
    for (const recipientEmails of [['ben@example.com'], ['ana@example.com', 'ben@example.com']]) {
      invoiceFacts = { ...invoiceFacts!, recipientEmails };
      const result = await (await connectInvoices()).callTool({ name: 'send_invoice', arguments: send });
      expect(text(result)).toBe('Blocked by payment guard. CUSTOMER_MISMATCH: Invoice INV2-ANA is not billed to the task customer ana@example.com alone');
    }
    expect(judgeCalls).toBe(0);
    expect(upstreamCalls).toEqual([]);
  });

  it('sends only a draft, and reminds only of an invoice still owed', async () => {
    invoiceFacts = { ...invoiceFacts!, status: 'PAID' };
    const agent = await connectInvoices();
    expect(text(await agent.callTool({ name: 'send_invoice', arguments: send }))).toContain('INVOICE_NOT_SENDABLE: Invoice status is PAID; only a DRAFT invoice can be sent');
    expect(text(await agent.callTool({ name: 'send_invoice_reminder', arguments: remind }))).toContain('INVOICE_NOT_SENDABLE');
    expect(upstreamCalls).toEqual([]);
  });

  it('reminds of an invoice at most once per task, counting executed and held reminders, but not blocked ones', async () => {
    invoiceFacts = { ...invoiceFacts!, status: 'UNPAID' };
    const agent = await connectInvoices();
    expect((await agent.callTool({ name: 'send_invoice_reminder', arguments: remind })).isError).toBeFalsy();
    const second = await agent.callTool({ name: 'send_invoice_reminder', arguments: remind });
    expect(text(second)).toBe('Blocked by payment guard. REMINDER_LIMIT: A task may send at most 1 reminder for invoice INV2-ANA');
    // Another invoice of the same customer has a reminder of its own.
    expect((await agent.callTool({ name: 'send_invoice_reminder', arguments: { invoice_id: 'INV2-ANA2' } })).isError).toBeFalsy();
    expect(entries.map((e) => e.outcome)).toEqual(['executed', 'blocked', 'executed']);
    expect(upstreamCalls).toHaveLength(2);

    entries = [];
    upstreamCalls = [];
    judgeDecision = { verdict: 'hold', violations: [{ code: 'INTENT_UNCERTAIN', message: 'unclear' }] };
    const holding = await connectInvoices();
    expect(text(await holding.callTool({ name: 'send_invoice_reminder', arguments: remind }))).toContain('Invoice reminder held for human approval');
    judgeDecision = { verdict: 'allow', violations: [] };
    expect(text(await holding.callTool({ name: 'send_invoice_reminder', arguments: remind }))).toContain('REMINDER_LIMIT');
    expect(entries.map((e) => e.outcome)).toEqual(['held', 'blocked']);

    entries = [];
    invoiceFacts = { ...invoiceFacts, status: 'PAID' };
    const blocking = await connectInvoices();
    await blocking.callTool({ name: 'send_invoice_reminder', arguments: remind });
    invoiceFacts = { ...invoiceFacts, status: 'UNPAID' };
    expect((await blocking.callTool({ name: 'send_invoice_reminder', arguments: remind })).isError).toBeFalsy();
    expect(entries.map((e) => e.outcome)).toEqual(['blocked', 'executed']);
  });

  it('holds a sending the judge is unsure about, and blocks one it rejects', async () => {
    judgeDecision = { verdict: 'hold', violations: [{ code: 'INTENT_UNCERTAIN', message: 'unclear' }] };
    expect(text(await (await connectInvoices()).callTool({ name: 'send_invoice', arguments: send }))).toContain('Invoice sending held for human approval');
    judgeDecision = { verdict: 'block', violations: [{ code: 'INTENT_MISMATCH', message: 'not asked' }] };
    expect(text(await (await connectInvoices()).callTool({ name: 'send_invoice', arguments: send }))).toContain('INTENT_MISMATCH');
    expect(entries.map((e) => e.outcome)).toEqual(['held', 'blocked']);
    expect(upstreamCalls).toEqual([]);
  });
});

describe('held invoice sending approval', () => {
  let invoiceFacts: InvoiceFacts | undefined;
  const hold = { verdict: 'hold' as const, violations: [{ code: 'INTENT_UNCERTAIN', message: 'unclear' }] };

  async function decide(heldId: string, approve: boolean, invoices: InvoiceLookup = { getInvoice: async (id) => invoiceFacts && { ...invoiceFacts, id } }) {
    const [upClient, upServer] = InMemoryTransport.createLinkedPair();
    await fakePayPal({ invoiceTools: true }).connect(upServer);
    const upstream = new Client({ name: 'approval-upstream', version: '0.0.0' });
    await upstream.connect(upClient);
    return decideHeldCall(
      { upstream, captures: { getCapture: async () => facts }, invoices, audit, limits: { approvalThreshold: usd(1000), perRefund: usd(10000), daily: usd(20000) }, now: () => new Date('2026-10-20T13:00:00Z'), timeoutMs: 50 },
      heldId,
      approve,
    );
  }

  beforeEach(() => {
    invoiceFacts = { id: 'INV2-ANA', status: 'DRAFT', amount: usd(2500), recipientEmails: ['ana@example.com'] };
  });

  it('sends an approved invoice, moving no money', async () => {
    entries.push({ at: '2026-10-20T12:00:00Z', tool: 'send_invoice', args: { invoice_id: 'INV2-ANA' }, task, decision: hold, outcome: 'held' });
    expect(await decide('0', true)).toEqual({ outcome: 'executed', message: 'Invoice INV2-ANA sent' });
    expect(upstreamCalls).toEqual([{ name: 'send_invoice', args: { invoice_id: 'INV2-ANA' } }]);
    expect(entries[1]).toMatchObject({ tool: 'send_invoice', resolves: '0', outcome: 'executed' });
    expect(entries[1].moved).toBeUndefined();
  });

  it('sends an approved reminder: the held reminder is the task one', async () => {
    invoiceFacts = { ...invoiceFacts!, status: 'SENT' };
    entries.push({ at: '2026-10-20T12:00:00Z', tool: 'send_invoice_reminder', args: { invoice_id: 'INV2-ANA' }, task, decision: hold, outcome: 'held' });
    expect(await decide('0', true)).toEqual({ outcome: 'executed', message: 'Reminder for invoice INV2-ANA sent' });
    expect(upstreamCalls).toEqual([{ name: 'send_invoice_reminder', args: { invoice_id: 'INV2-ANA' } }]);
  });

  it('checks the invoice again on approval, and keeps the hold open when PayPal cannot be reached', async () => {
    entries.push({ at: '2026-10-20T12:00:00Z', tool: 'send_invoice', args: { invoice_id: 'INV2-ANA' }, task, decision: hold, outcome: 'held' });
    const unreachable = await decide('0', true, { getInvoice: async () => { throw new Error('connect timeout'); } });
    expect(unreachable).toEqual({ outcome: 'error', message: 'PayPal could not be reached to check the invoice; the invoice sending is still held, try again' });
    expect(entries).toHaveLength(1);
    invoiceFacts = { ...invoiceFacts!, status: 'SENT' };
    const result = await decide('0', true);
    expect(result.outcome).toBe('blocked');
    expect(result.message).toContain('INVOICE_NOT_SENDABLE');
    expect(upstreamCalls).toEqual([]);
  });

  it('records a rejection without reaching PayPal', async () => {
    entries.push({ at: '2026-10-20T12:00:00Z', tool: 'send_invoice_reminder', args: { invoice_id: 'INV2-ANA' }, task, decision: hold, outcome: 'held' });
    expect(await decide('0', false)).toEqual({ outcome: 'blocked', message: 'Invoice reminder rejected; nothing was sent to PayPal' });
    expect(upstreamCalls).toEqual([]);
  });
});

describe('invoice reads', () => {
  const connectReads = () => connect(undefined, { invoiceTools: true });

  it('returns an invoice of the task customer without the invoicer, the recipients or links, and logs the read', async () => {
    const result = await (await connectReads()).callTool({ name: 'get_invoice', arguments: { invoice_id: 'INV2-ANA' } });
    expect(result.isError).toBeFalsy();
    expect(JSON.parse(text(result))).toEqual({
      id: 'INV2-ANA',
      status: 'SENT',
      detail: { invoice_number: '0042', currency_code: 'USD', invoice_date: '2026-10-20', payment_term: { due_date: '2026-10-30' } },
      items: [{ name: 'Mug', quantity: '2', unit_amount: { currency_code: 'USD', value: '12.50' } }],
      amount: { currency_code: 'USD', value: '25.00' },
      due_amount: { currency_code: 'USD', value: '25.00' },
      withheld_by_guard: ['detail.payment_term.term_type', 'invoicer', 'primary_recipients', 'links'],
    });
    expect(text(result)).not.toContain('ana@example.com');
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ tool: 'get_invoice', outcome: 'executed', detail: 'Withheld from the agent: detail.payment_term.term_type, invoicer, primary_recipients, links' });
    expect(entries[0].moved).toBeUndefined();
    expect(judgeCalls).toBe(0);
  });

  it("withholds another customer's invoice, one billing several people, or one that can't be read", async () => {
    const agent = await connectReads();
    for (const invoice_id of ['INV2-BEN', 'INV2-BOTH', 'INV2-GARBLED']) {
      const result = await agent.callTool({ name: 'get_invoice', arguments: { invoice_id } });
      expect(text(result)).toBe('Blocked by payment guard. CUSTOMER_MISMATCH: Invoice is not one of the ticket customer ana@example.com');
      expect(text(result)).not.toContain('ben@example.com');
    }
    expect(entries.map((e) => e.outcome)).toEqual(['blocked', 'blocked', 'blocked']);
  });

  it('refuses an invoice id that is not a plain id before PayPal is called', async () => {
    const agent = await connectReads();
    for (const invoice_id of ['../../v2/checkout/orders/X', 'INV2?x=1', '']) {
      expect(text(await agent.callTool({ name: 'get_invoice', arguments: { invoice_id } }))).toContain('INVALID_ARGUMENTS: invoice_id must be a plain invoice id');
    }
    expect(upstreamCalls).toEqual([]);
  });
});

// Regression probes from the independent verification of the billing agent (T9).
const invArgs = (o: Record<string, unknown> = {}) => ({
  currency_code: 'USD',
  primary_recipients: [{ billing_info: { email_address: 'ana@example.com' } }],
  items: [{ name: 'Mug', quantity: '1', unit_amount: { currency_code: 'USD', value: '25.00' } }],
  ...o,
});
const item = (value: string, quantity = '1', extra: Record<string, unknown> = {}) => ({ name: 'X', quantity, unit_amount: { currency_code: 'USD', value }, ...extra });
const seedDir: CustomerDirectory = { isCustomer: async (e) => ['ana@example.com', 'ben@example.com', 'carla@example.com'].includes(e.trim().toLowerCase()) };
const limitsInv: InvoiceLimits = { approvalThreshold: usd(10000), perInvoice: usd(50000), daily: usd(100000) };

describe('probe: create_invoice', () => {
  const conn = (o: Parameters<typeof connect>[1] = {}) => connect(undefined, { customers: seedDir, invoiceLimits: limitsInv, invoiceTools: true, ...o });

  it('blocks a recipient other than the mandate customer', async () => {
    const r = await (await conn()).callTool({ name: 'create_invoice', arguments: invArgs({ primary_recipients: [{ billing_info: { email_address: 'ben@example.com' } }] }) });
    expect(r.isError).toBe(true);
    expect(text(r)).toContain('CUSTOMER_MISMATCH');
    expect(upstreamCalls).toEqual([]);
  });
  it('blocks when the mandate customer is not a seed customer', async () => {
    const agent = await connect(undefined, { customers: { isCustomer: async () => false }, invoiceLimits: limitsInv, invoiceTools: true });
    const r = await agent.callTool({ name: 'create_invoice', arguments: invArgs() });
    expect(text(r)).toContain('UNKNOWN_CUSTOMER');
    expect(upstreamCalls).toEqual([]);
  });
  it('blocks a total over 500 (500.01) and allows exactly 100.00 without a hold', async () => {
    const r = await (await conn()).callTool({ name: 'create_invoice', arguments: invArgs({ items: [item('500.01')] }) });
    expect(text(r)).toContain('INVOICE_LIMIT');
    expect(text(r)).not.toContain('APPROVAL_REQUIRED');
    const ok = await (await conn()).callTool({ name: 'create_invoice', arguments: invArgs({ items: [item('100.00')] }) });
    expect(text(ok)).toBe('create_invoice ok');
  });
  it('holds a total in (100, 500], including exactly 500.00 and 100.01; moved nothing', async () => {
    for (const v of ['100.01', '500.00']) {
      const r = await (await conn()).callTool({ name: 'create_invoice', arguments: invArgs({ items: [item(v)] }) });
      expect(text(r)).toMatch(/^Invoice held for human approval/);
    }
    expect(upstreamCalls).toEqual([]);
    expect(entries.every((e) => e.outcome === 'held' && e.moved === undefined)).toBe(true);
  });
  it('counts shipping in the total (400 + 100.01 shipping is blocked)', async () => {
    const r = await (await conn()).callTool({ name: 'create_invoice', arguments: invArgs({ items: [item('400.00')], shipping_cost: '100.01' }) });
    expect(text(r)).toContain('INVOICE_LIMIT');
  });
  it('rounds a fractional-cent total up: 0.333 x 300.00 = 99.90 allowed; 3 x 33.34 = 100.02 held; 0.333 x 300.31 = 100.003 -> 100.01 held', async () => {
    expect(text(await (await conn()).callTool({ name: 'create_invoice', arguments: invArgs({ items: [item('300.00', '0.333')] }) }))).toBe('create_invoice ok');
    expect(entries.at(-1)?.moved).toEqual(usd(9990));
    expect(text(await (await conn()).callTool({ name: 'create_invoice', arguments: invArgs({ items: [item('300.31', '0.333')] }) }))).toMatch(/^Invoice held/);
  });
  it('refuses malformed drafts as INVALID_ARGUMENTS before the directory, judge or PayPal', async () => {
    const bad = [
      invArgs({ items: [item('10.00', '1', { tax: { name: 'VAT', percent: '100' } })] }),
      invArgs({ primary_recipients: [{ billing_info: { email_address: 'ana@example.com' } }, { billing_info: { email_address: 'ana@example.com' } }] }),
      invArgs({ primary_recipients: [] }),
      invArgs({ items: [] }),
      invArgs({ items: [item('-10.00')] }),
      invArgs({ items: [item('10.001')] }),
      invArgs({ items: [item('10.00', '-1')] }),
      invArgs({ items: [item('10.00', '0')] }),
      invArgs({ items: [{ name: 'X', quantity: '1', unit_amount: { currency_code: 'EUR', value: '10.00' } }] }),
      invArgs({ shipping_cost: '-5' }),
      invArgs({ items: [item('0.00')] }),
    ];
    for (const args of bad) {
      const r = await (await conn()).callTool({ name: 'create_invoice', arguments: args });
      expect(text(r), JSON.stringify(args)).toContain('INVALID_ARGUMENTS');
    }
    expect(upstreamCalls).toEqual([]);
    expect(judgeCalls).toBe(0);
  });
  it('blocks an invoice in another currency than the limits (fails closed)', async () => {
    const r = await (await conn()).callTool({ name: 'create_invoice', arguments: invArgs({ currency_code: 'EUR', items: [{ name: 'X', quantity: '1', unit_amount: { currency_code: 'EUR', value: '1.00' } }] }) });
    expect(r.isError).toBe(true);
    expect(upstreamCalls).toEqual([]);
  });
  it('daily cap 1000 counts invoices only; refunds and invoices do not share totals', async () => {
    entries.push({ at: '2026-10-20T11:00:00Z', tool: 'create_refund', args: { capture_id: 'CAP-9' }, task, decision: { verdict: 'allow', violations: [] }, outcome: 'executed', moved: usd(19000) });
    entries.push({ at: '2026-10-20T11:00:00Z', tool: 'create_invoice', args: {}, task, decision: { verdict: 'allow', violations: [] }, outcome: 'executed', moved: usd(95000) });
    const r = await (await conn()).callTool({ name: 'create_invoice', arguments: invArgs({ items: [item('50.01')] }) });
    expect(text(r)).toContain('DAILY_LIMIT');
    const ok = await (await conn()).callTool({ name: 'create_invoice', arguments: invArgs({ items: [item('50.00')] }) });
    expect(text(ok)).toBe('create_invoice ok');
    // Refund limit 200 per day: 190 refunded, 10 more allowed despite 1000 billed.
    const refund = await (await conn()).callTool({ name: 'create_refund', arguments: { capture_id: 'CAP-1', amount: { currency_code: 'USD', value: '10.00' } } });
    expect(refund.isError).toBeFalsy();
  });
  it('a blocked write leaves movedSince/billedSince unchanged', async () => {
    const before = [await audit.movedSince(new Date(0), 'USD'), await audit.billedSince(new Date(0), 'USD')];
    const agent = await conn();
    await agent.callTool({ name: 'create_invoice', arguments: invArgs({ items: [item('600.00')] }) });
    await agent.callTool({ name: 'create_invoice', arguments: invArgs({ primary_recipients: [{ billing_info: { email_address: 'ben@example.com' } }] }) });
    expect([await audit.movedSince(new Date(0), 'USD'), await audit.billedSince(new Date(0), 'USD')]).toEqual(before);
    expect(entries.every((e) => e.outcome === 'blocked' && e.moved === undefined)).toBe(true);
  });
  it('approval of a held invoice re-checks (customer still known, daily cap) and executes', async () => {
    const agent = await conn();
    await agent.callTool({ name: 'create_invoice', arguments: invArgs({ items: [item('200.00')] }) });
    expect(entries[0].outcome).toBe('held');
    const [upClient, upServer] = InMemoryTransport.createLinkedPair();
    await fakePayPal({ invoiceTools: true }).connect(upServer);
    const upstream = new Client({ name: 'u', version: '0' });
    await upstream.connect(upClient);
    const deps = { upstream, captures: { getCapture: async () => facts }, customers: seedDir, audit, limits: { approvalThreshold: usd(1000), perRefund: usd(10000), daily: usd(20000) }, invoiceLimits: limitsInv, now: () => new Date('2026-10-20T13:00:00Z'), timeoutMs: 50 };
    // Billed 850 since the hold: 850 + 200 > 1000 -> blocked on approval.
    entries.push({ at: '2026-10-20T12:30:00Z', tool: 'create_invoice', args: {}, task, decision: { verdict: 'allow', violations: [] }, outcome: 'executed', moved: usd(85000) });
    expect((await decideHeldCall(deps, '0', true)).outcome).toBe('blocked');
    // Fresh hold, no billing since: executes.
    entries.length = 0;
    upstreamCalls = [];
    entries.push({ at: '2026-10-20T12:00:00Z', tool: 'create_invoice', args: invArgs({ items: [item('200.00')] }), task, decision: { verdict: 'hold', violations: [] }, outcome: 'held' });
    expect(await decideHeldCall(deps, '0', true)).toEqual({ outcome: 'executed', message: 'Invoice created in PayPal for 200.00 USD' });
    expect(upstreamCalls.map((c) => c.name)).toEqual(['create_invoice']);
    expect(entries.at(-1)).toMatchObject({ outcome: 'executed', moved: usd(20000), resolves: '0' });
    // Unknown customer at approval -> refused/blocked, nothing sent.
    entries.length = 0;
    upstreamCalls = [];
    entries.push({ at: '2026-10-20T12:00:00Z', tool: 'create_invoice', args: invArgs({ items: [item('200.00')] }), task, decision: { verdict: 'hold', violations: [] }, outcome: 'held' });
    expect((await decideHeldCall({ ...deps, customers: { isCustomer: async () => false } }, '0', true)).outcome).toBe('blocked');
    // Directory down at approval -> hold stays open.
    entries.length = 0;
    entries.push({ at: '2026-10-20T12:00:00Z', tool: 'create_invoice', args: invArgs({ items: [item('200.00')] }), task, decision: { verdict: 'hold', violations: [] }, outcome: 'held' });
    expect((await decideHeldCall({ ...deps, customers: { isCustomer: async () => { throw new Error('down'); } } }, '0', true)).outcome).toBe('error');
    expect(await audit.isResolved('0')).toBe(false);
    expect(upstreamCalls).toEqual([]);
  });
});

describe('probe: send_invoice / send_invoice_reminder', () => {
  let facts2: InvoiceFacts | undefined;
  let fail = false;
  const invoices: InvoiceLookup = { getInvoice: async (id) => { if (fail) throw new Error('timeout'); return facts2 && { ...facts2, id }; } };
  const conn = () => connect(undefined, { invoices, invoiceTools: true });
  beforeEach(() => {
    facts2 = { id: 'INV2-ANA', status: 'DRAFT', amount: usd(2500), recipientEmails: ['ana@example.com'] };
    fail = false;
  });
  for (const tool of ['send_invoice', 'send_invoice_reminder']) {
    it(`${tool}: additional_recipients / send_to_recipient false are blocked`, async () => {
      if (tool === 'send_invoice_reminder') facts2!.status = 'SENT';
      const agent = await conn();
      expect(text(await agent.callTool({ name: tool, arguments: { invoice_id: 'INV2-ANA', additional_recipients: ['evil@x.com'] } }))).toContain('INVALID_ARGUMENTS');
      expect(text(await agent.callTool({ name: tool, arguments: { invoice_id: 'INV2-ANA', send_to_recipient: false } }))).toContain('INVALID_ARGUMENTS');
      expect(upstreamCalls).toEqual([]);
    });
    it(`${tool}: another customer's invoice or lookup failure is blocked`, async () => {
      if (tool === 'send_invoice_reminder') facts2!.status = 'UNPAID';
      facts2!.recipientEmails = ['ben@example.com'];
      expect(text(await (await conn()).callTool({ name: tool, arguments: { invoice_id: 'INV2-BEN' } }))).toContain('CUSTOMER_MISMATCH');
      fail = true;
      expect(text(await (await conn()).callTool({ name: tool, arguments: { invoice_id: 'INV2-ANA' } }))).toContain('INVOICE_LOOKUP_FAILED');
      expect(upstreamCalls).toEqual([]);
    });
  }
  it('wrong status is blocked for both', async () => {
    facts2!.status = 'PAID';
    expect(text(await (await conn()).callTool({ name: 'send_invoice', arguments: { invoice_id: 'INV2-ANA' } }))).toContain('INVOICE_NOT_SENDABLE');
    expect(text(await (await conn()).callTool({ name: 'send_invoice_reminder', arguments: { invoice_id: 'INV2-ANA' } }))).toContain('INVOICE_NOT_SENDABLE');
    facts2!.status = 'DRAFT';
    expect(text(await (await conn()).callTool({ name: 'send_invoice_reminder', arguments: { invoice_id: 'INV2-ANA' } }))).toContain('INVOICE_NOT_SENDABLE');
    expect(upstreamCalls).toEqual([]);
  });
  it('a second reminder of the same invoice in one task is blocked; another invoice is not', async () => {
    facts2!.status = 'SENT';
    const agent = await conn();
    expect(text(await agent.callTool({ name: 'send_invoice_reminder', arguments: { invoice_id: 'INV2-ANA' } }))).toBe('send_invoice_reminder ok');
    expect(text(await agent.callTool({ name: 'send_invoice_reminder', arguments: { invoice_id: 'INV2-ANA' } }))).toContain('REMINDER_LIMIT');
    expect(text(await agent.callTool({ name: 'send_invoice_reminder', arguments: { invoice_id: 'INV2-OTHER' } }))).toBe('send_invoice_reminder ok');
    expect(upstreamCalls.map((c) => c.name)).toEqual(['send_invoice_reminder', 'send_invoice_reminder']);
  });
  it('a held reminder stays open when the lookup fails at approval', async () => {
    facts2!.status = 'SENT';
    entries.push({ at: '2026-10-20T12:00:00Z', tool: 'send_invoice_reminder', args: { invoice_id: 'INV2-ANA' }, task, decision: { verdict: 'hold', violations: [] }, outcome: 'held' });
    fail = true;
    const [upClient, upServer] = InMemoryTransport.createLinkedPair();
    await fakePayPal({ invoiceTools: true }).connect(upServer);
    const upstream = new Client({ name: 'u', version: '0' });
    await upstream.connect(upClient);
    const deps = { upstream, captures: { getCapture: async () => facts }, invoices, audit, limits: { approvalThreshold: usd(1000), perRefund: usd(10000), daily: usd(20000) }, now: () => new Date('2026-10-20T13:00:00Z'), timeoutMs: 50 };
    expect((await decideHeldCall(deps, '0', true)).outcome).toBe('error');
    expect(await audit.isResolved('0')).toBe(false);
    fail = false;
    expect(await decideHeldCall(deps, '0', true)).toEqual({ outcome: 'executed', message: 'Reminder for invoice INV2-ANA sent' });
    expect(upstreamCalls.map((c) => c.name)).toEqual(['send_invoice_reminder']);
  });
});

describe('probe: get_invoice and tools outside the design', () => {
  it("withholds another customer's invoice and minimizes the own one", async () => {
    const agent = await connect(undefined, { invoiceTools: true });
    const other = await agent.callTool({ name: 'get_invoice', arguments: { invoice_id: 'INV2-BEN' } });
    expect(text(other)).toContain('CUSTOMER_MISMATCH');
    expect(text(other)).not.toContain('ben@example.com');
    const own = await agent.callTool({ name: 'get_invoice', arguments: { invoice_id: 'INV2-ANA' } });
    const { withheld_by_guard, ...kept } = JSON.parse(text(own));
    expect(JSON.stringify(kept)).not.toMatch(/ana@example\.com|shop@business|Someone|invoicer|primary_recipients|links/);
    expect(withheld_by_guard).toEqual(expect.arrayContaining(['invoicer', 'primary_recipients', 'links']));
    expect(kept).toMatchObject({ id: 'INV2-ANA', amount: { currency_code: 'USD', value: '25.00' } });
  });
  it('blocks invoice tools outside the design with TOOL_NOT_ALLOWED', async () => {
    const agent = await connect(undefined, { invoiceTools: true });
    for (const name of ['delete_invoice', 'cancel_sent_invoice', 'update_invoicing', 'list_invoices', 'search_invoicing', 'record_payment_for_invoice', 'create_recurring_series']) {
      const r = await agent.callTool({ name, arguments: { invoice_id: 'INV2-ANA' } });
      expect(text(r), name).toContain('TOOL_NOT_ALLOWED');
    }
    expect(upstreamCalls).toEqual([]);
  });
});

const SHOP = 'https://shop.example';
// create_order's arguments as the toolkit takes them: 2 mug sets for 99.98 USD, back to the shop.
const orderArgs = (overrides: Record<string, unknown> = {}) => ({
  currencyCode: 'USD',
  items: [{ name: 'Ceramic mug set', quantity: 2, itemCost: 49.99, taxPercent: 0, itemTotal: 99.98 }],
  discount: 0,
  shippingCost: 0,
  returnUrl: `${SHOP}/sales/paypal-return`,
  cancelUrl: `${SHOP}/sales`,
  ...overrides,
});
const tablecloths = (quantity: number) => orderArgs({ items: [{ name: 'Linen tablecloth', quantity, itemCost: 120, taxPercent: 0, itemTotal: 120 * quantity }] });

describe('order creation', () => {
  let bound: { orderId: string; customerEmail: string }[];
  let bindFails: boolean;
  // Like PayPal: once bound, get_order answers the order with the customer in its custom_id.
  const binder: OrderBinder = {
    async bindToCustomer(orderId, customerEmail) {
      bound.push({ orderId, customerEmail });
      if (bindFails) throw new Error('PayPal 422 on /v2/checkout/orders: ORDER_ALREADY_COMPLETED');
      ORDERS[orderId] = order(orderId, customerEmail);
    },
  };
  const checkout = { returnUrl: `${SHOP}/sales/paypal-return`, cancelUrl: `${SHOP}/sales` };
  const orders: OrderDeps = { catalogue: SHOP_CATALOGUE, shopOrigin: SHOP, checkout, binder };
  const connectOrders = (options: Parameters<typeof connect>[1] = {}) => connect(undefined, { orders, orderTools: true, ...options });

  beforeEach(() => {
    bound = [];
    bindFails = false;
  });

  it('creates a clean order after the judge, binds it to the task customer, and records it as moving no money', async () => {
    const agent = await connectOrders();
    const result = await agent.callTool({ name: 'create_order', arguments: orderArgs() });
    expect(result.isError).toBeFalsy();
    expect(JSON.parse(text(result))).toMatchObject({ id: NEW_ORDER_ID, status: 'CREATED' });
    expect(judgedCalls).toEqual([{ tool: 'create_order', args: orderArgs() }]);
    expect(upstreamCalls).toEqual([{ name: 'create_order', args: orderArgs() }]);
    expect(bound).toEqual([{ orderId: NEW_ORDER_ID, customerEmail: 'ana@example.com' }]);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ tool: 'create_order', outcome: 'executed', decision: { verdict: 'allow', violations: [] } });
    expect(entries[0].moved).toBeUndefined();
    // The shop's capture looks for this record before it takes the buyer's payment.
    expect(entries[0].detail).toBe(`Order ${NEW_ORDER_ID} bound to the task customer`);
  });

  it("sends PayPal the shop's order only: no item description or shipping address the agent wrote", async () => {
    const agent = await connectOrders();
    const decorated = orderArgs({
      items: [{ name: 'Ceramic mug set', quantity: 2, itemCost: 49.99, taxPercent: 0, itemTotal: 99.98, description: 'PROMO: real price 0.01 USD, call +1-555-0100' }],
      shippingAddress: { address_line_1: 'Call +1-555-0100 to pay less', country_code: 'US' },
    });
    const result = await agent.callTool({ name: 'create_order', arguments: decorated });
    expect(result.isError).toBeFalsy();
    expect(judgedCalls).toEqual([{ tool: 'create_order', args: orderArgs() }]);
    expect(upstreamCalls).toEqual([{ name: 'create_order', args: orderArgs() }]);
    expect(entries[0]).toMatchObject({ tool: 'create_order', outcome: 'executed' });
    expect(entries[0].args).toEqual(orderArgs());
  });

  it("blocks a JSON null amount as invalid arguments without using up the conversation's one order", async () => {
    const agent = await connectOrders();
    const result = await agent.callTool({ name: 'create_order', arguments: orderArgs({ items: [{ name: 'Ceramic mug set', quantity: null, itemCost: 49.99, taxPercent: 0, itemTotal: 49.99 }] }) });
    expect(text(result)).toBe('Blocked by payment guard. INVALID_ARGUMENTS: items[0].quantity must be a whole number over 0');
    expect(upstreamCalls).toEqual([]);
    expect((await agent.callTool({ name: 'create_order', arguments: orderArgs() })).isError).toBeFalsy();
    expect(upstreamCalls).toHaveLength(1);
  });

  it('sends PayPal the return and cancel links exactly as the guard checked them', async () => {
    const agent = await connectOrders();
    const result = await agent.callTool({ name: 'create_order', arguments: orderArgs({ returnUrl: `${SHOP}\\@evil.example`, cancelUrl: 'HTTPS://Shop.Example:443/sales' }) });
    expect(result.isError).toBeFalsy();
    expect(upstreamCalls).toEqual([{ name: 'create_order', args: orderArgs({ returnUrl: `${SHOP}/@evil.example`, cancelUrl: `${SHOP}/sales` }) }]);
  });

  it("fills in the shop's own return and cancel links the agent left out, and still blocks foreign ones", async () => {
    const agent = await connectOrders();
    const withoutLinks: Record<string, unknown> = orderArgs();
    delete withoutLinks.returnUrl;
    delete withoutLinks.cancelUrl;
    const result = await agent.callTool({ name: 'create_order', arguments: withoutLinks });
    expect(result.isError).toBeFalsy();
    expect(upstreamCalls).toEqual([{ name: 'create_order', args: { ...withoutLinks, ...checkout } }]);
    expect(entries[0]).toMatchObject({ tool: 'create_order', outcome: 'executed', args: { ...withoutLinks, ...checkout } });

    const foreign = await (await connectOrders()).callTool({ name: 'create_order', arguments: { ...withoutLinks, cancelUrl: 'https://evil.example/' } });
    expect(text(foreign)).toContain('RETURN_URL_NOT_SHOP');

    // A null link is a missing one: the shop's own replaces it, so PayPal gets a link it accepts.
    const nulls = await (await connectOrders()).callTool({ name: 'create_order', arguments: { ...withoutLinks, returnUrl: null, cancelUrl: null } });
    expect(nulls.isError).toBeFalsy();
    expect(upstreamCalls.at(-1)).toEqual({ name: 'create_order', args: { ...withoutLinks, ...checkout } });
  });

  it("lets get_order read the customer's own new order once it is bound", async () => {
    const agent = await connectOrders();
    await agent.callTool({ name: 'create_order', arguments: orderArgs() });
    const read = await agent.callTool({ name: 'get_order', arguments: { id: NEW_ORDER_ID } });
    expect(read.isError).toBeFalsy();
    expect(JSON.parse(text(read))).toMatchObject({ id: NEW_ORDER_ID, withheld_by_guard: ['purchase_units[0].custom_id'] });
    expect(entries.map((e) => [e.tool, e.outcome])).toEqual([['create_order', 'executed'], ['get_order', 'executed']]);
  });

  it('blocks orders that break the catalogue rules without asking the judge, PayPal or the binder', async () => {
    const agent = await connectOrders();
    const cases: [Record<string, unknown>, string][] = [
      [orderArgs({ discount: 89.98 }), 'DISCOUNT_LIMIT: Discount 89.98 USD is over 10 % of the items, at most 9.99 USD'],
      [orderArgs({ items: [{ name: 'Ceramic mug set', quantity: 2, itemCost: 0.99, taxPercent: 0, itemTotal: 1.98 }] }), 'PRICE_MISMATCH'],
      [orderArgs({ items: [{ name: 'Gold watch', quantity: 1, itemCost: 10, taxPercent: 0, itemTotal: 10 }] }), 'NOT_IN_CATALOGUE'],
      [tablecloths(50), 'QUANTITY_LIMIT'],
      [orderArgs({ returnUrl: 'https://evil.example/pay' }), 'RETURN_URL_NOT_SHOP'],
      [orderArgs({ shippingCost: 15 }), 'SHIPPING_MISMATCH'],
    ];
    for (const [args, reason] of cases) {
      const result = await agent.callTool({ name: 'create_order', arguments: args });
      expect(result.isError).toBe(true);
      expect(text(result)).toContain(`Blocked by payment guard. ${reason}`);
    }
    expect(entries.map((e) => e.outcome)).toEqual(cases.map(() => 'blocked'));
    expect(judgeCalls).toBe(0);
    expect(upstreamCalls).toEqual([]);
    expect(bound).toEqual([]);
  });

  it('blocks malformed orders as invalid arguments', async () => {
    const result = await (await connectOrders()).callTool({ name: 'create_order', arguments: orderArgs({ items: [] }) });
    expect(text(result)).toBe('Blocked by payment guard. INVALID_ARGUMENTS: create_order needs 1 to 50 items');
    expect(upstreamCalls).toEqual([]);
  });

  it('fails closed when no catalogue, shop origin and binder are configured, instead of falling through to the refund check', async () => {
    const result = await (await connect(undefined, { orderTools: true })).callTool({ name: 'create_order', arguments: orderArgs() });
    expect(text(result)).toBe('Blocked by payment guard. CATALOGUE_UNAVAILABLE: No shop catalogue, shop origin or order binder is configured');
    expect(judgeCalls).toBe(0);
    expect(upstreamCalls).toEqual([]);
    expect(entries[0]).toMatchObject({ tool: 'create_order', outcome: 'blocked' });
  });

  it('blocks a clean order the judge rejects', async () => {
    judgeDecision = { verdict: 'block', violations: [{ code: 'INTENT_MISMATCH', message: 'The customer asked for one mug set' }] };
    const result = await (await connectOrders()).callTool({ name: 'create_order', arguments: orderArgs() });
    expect(text(result)).toContain('INTENT_MISMATCH');
    expect(upstreamCalls).toEqual([]);
    expect(bound).toEqual([]);
  });

  it('creates one order per conversation, counting a held one', async () => {
    let agent = await connectOrders();
    expect((await agent.callTool({ name: 'create_order', arguments: orderArgs() })).isError).toBeFalsy();
    const second = await agent.callTool({ name: 'create_order', arguments: orderArgs() });
    expect(text(second)).toBe('Blocked by payment guard. ORDER_LIMIT: A conversation may create at most 1 order');
    expect(upstreamCalls).toHaveLength(1);

    agent = await connectOrders();
    expect(text(await agent.callTool({ name: 'create_order', arguments: tablecloths(3) }))).toContain('Order held for human approval');
    expect(text(await agent.callTool({ name: 'create_order', arguments: orderArgs() }))).toContain('ORDER_LIMIT');
    expect(upstreamCalls).toHaveLength(1);
  });

  it('holds a clean order over the approval threshold, tells a person, and creates nothing yet', async () => {
    const notified: AuditRow[] = [];
    const agent = await connectOrders({ notifier: { notifyHeld: async (entry) => void notified.push(entry) } });
    const result = await agent.callTool({ name: 'create_order', arguments: tablecloths(3) });
    expect(result.isError).toBeFalsy();
    expect(text(result)).toBe(
      'Order held for human approval; it has not been executed. Tell the customer a person will review it. APPROVAL_REQUIRED: Order 360.00 USD is over the approval threshold 300.00 USD',
    );
    expect(judgeCalls).toBe(1);
    expect(upstreamCalls).toEqual([]);
    expect(bound).toEqual([]);
    expect(entries[0]).toMatchObject({ tool: 'create_order', outcome: 'held' });
    expect(notified).toHaveLength(1);
  });

  it('tells the agent, and records, an order PayPal created but the guard could not bind to the customer', async () => {
    bindFails = true;
    const agent = await connectOrders();
    const result = await agent.callTool({ name: 'create_order', arguments: orderArgs() });
    expect(result.isError).toBe(true);
    expect(text(result)).toBe(
      `Order ${NEW_ORDER_ID} was created in PayPal but could not be recorded as the customer's: PayPal 422 on /v2/checkout/orders: ORDER_ALREADY_COMPLETED. Do not give the customer its approval link; a person must check the order in PayPal first.`,
    );
    expect(text(result)).not.toContain('checkoutnow');
    expect(upstreamCalls).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      tool: 'create_order',
      outcome: 'executed',
      detail: `Order ${NEW_ORDER_ID} was created in PayPal but not bound to the task customer: PayPal 422 on /v2/checkout/orders: ORDER_ALREADY_COMPLETED`,
    });
    // Retrying would create a second unbound order.
    expect(text(await agent.callTool({ name: 'create_order', arguments: orderArgs() }))).toContain('ORDER_LIMIT');
  });

  it('treats an answer without a readable order id as an unbound order', async () => {
    createdOrderAnswer = JSON.stringify({ status: 'CREATED' });
    const result = await (await connectOrders()).callTool({ name: 'create_order', arguments: orderArgs() });
    expect(result.isError).toBe(true);
    expect(text(result)).toContain("Order (unreadable id) was created in PayPal but could not be recorded as the customer's");
    expect(bound).toEqual([]);
    expect(entries[0].detail).toContain('PayPal answered without a plain order id');
  });

  it('binds nothing when PayPal rejects the order', async () => {
    rejectOrders = true;
    const result = await (await connectOrders()).callTool({ name: 'create_order', arguments: orderArgs() });
    expect(result.isError).toBe(true);
    expect(bound).toEqual([]);
    expect(entries[0]).toMatchObject({ tool: 'create_order', outcome: 'error' });
  });

  it('still checks a refund as a refund next to orders, and orders never count toward the refund daily limit', async () => {
    entries.push({ at: '2026-10-20T11:00:00Z', tool: 'create_order', args: tablecloths(5), task, decision: { verdict: 'allow', violations: [] }, outcome: 'executed', moved: usd(19000) });
    const agent = await connectOrders();
    const refund = await agent.callTool({ name: 'create_refund', arguments: { capture_id: 'CAP-1', amount: { currency_code: 'USD', value: '50.00' } } });
    expect(refund.isError).toBeFalsy();
    expect(entries[1]).toMatchObject({ tool: 'create_refund', outcome: 'executed', moved: usd(5000) });
  });
});

describe('held order approval', () => {
  let bound: string[];
  let bindFails: boolean;
  const binder: OrderBinder = {
    async bindToCustomer(orderId, customerEmail) {
      bound.push(`${orderId} ${customerEmail}`);
      if (bindFails) throw new Error('PayPal 500');
    },
  };
  const held = tablecloths(3);
  const hold = { verdict: 'hold' as const, violations: [{ code: 'APPROVAL_REQUIRED', message: 'over threshold' }] };

  // `null`: no catalogue configured.
  async function decide(heldId: string, approve: boolean, orders: OrderDeps | null = { catalogue: SHOP_CATALOGUE, shopOrigin: SHOP, checkout: { returnUrl: `${SHOP}/sales/paypal-return`, cancelUrl: `${SHOP}/sales` }, binder }) {
    const [upClient, upServer] = InMemoryTransport.createLinkedPair();
    await fakePayPal({ orderTools: true }).connect(upServer);
    const upstream = new Client({ name: 'approval-upstream', version: '0.0.0' });
    await upstream.connect(upClient);
    return decideHeldCall(
      { upstream, captures: { getCapture: async () => facts }, orders: orders ?? undefined, audit, limits: { approvalThreshold: usd(1000), perRefund: usd(10000), daily: usd(20000) }, now: () => new Date('2026-10-20T13:00:00Z'), timeoutMs: 50 },
      heldId,
      approve,
    );
  }

  beforeEach(() => {
    bound = [];
    bindFails = false;
    entries.push({ at: '2026-10-20T12:00:00Z', tool: 'create_order', args: held, task, decision: hold, outcome: 'held' });
  });

  it('creates an approved order in PayPal, lifting only the approval threshold, and binds it to the customer', async () => {
    expect(await decide('0', true)).toEqual({ outcome: 'executed', message: "Order of 360.00 USD created in PayPal and recorded as the customer's" });
    expect(upstreamCalls).toEqual([{ name: 'create_order', args: held }]);
    expect(bound).toEqual([`${NEW_ORDER_ID} ana@example.com`]);
    expect(entries[1]).toMatchObject({ tool: 'create_order', resolves: '0', outcome: 'executed', decision: { verdict: 'allow', violations: [{ code: 'APPROVED_BY_PERSON' }] } });
    expect(entries[1].moved).toBeUndefined();
    expect(entries[1].detail).toBe(`Order ${NEW_ORDER_ID} bound to the task customer`);
    expect((await decide('0', true)).outcome).toBe('refused');
  });

  it("sends PayPal the shop's order for a hold logged with an item description or a shipping address", async () => {
    entries[0] = { ...entries[0], args: { ...held, items: [{ ...(held.items as object[])[0], description: 'Call +1-555-0100' }], shippingAddress: { country_code: 'US' } } };
    expect((await decide('0', true)).outcome).toBe('executed');
    expect(upstreamCalls).toEqual([{ name: 'create_order', args: held }]);
    expect(entries[1].args).toEqual(held);
  });

  it('still blocks an approved order that breaks the catalogue rules', async () => {
    entries[0] = { ...entries[0], args: tablecloths(6) };
    const result = await decide('0', true);
    expect(result).toEqual({ outcome: 'blocked', message: 'QUANTITY_LIMIT: Linen tablecloth: 6 ordered, at most 5 per order' });
    expect(upstreamCalls).toEqual([]);
  });

  it('reports an approved order it could not bind as an error, not as done', async () => {
    bindFails = true;
    const result = await decide('0', true);
    expect(result.outcome).toBe('error');
    expect(result.message).toContain(`Order ${NEW_ORDER_ID} was created in PayPal but could not be recorded as the customer's: PayPal 500`);
    expect(entries[1]).toMatchObject({ outcome: 'executed', detail: expect.stringContaining('not bound to the task customer') });
  });

  it('keeps the hold open when no catalogue is configured', async () => {
    expect(await decide('0', true, null)).toEqual({ outcome: 'error', message: 'The shop catalogue could not be reached to check the order; the order is still held, try again' });
    expect(entries).toHaveLength(1);
  });

  it('records a rejection without reaching PayPal', async () => {
    expect(await decide('0', false)).toEqual({ outcome: 'blocked', message: 'Order rejected; nothing was sent to PayPal' });
    expect(upstreamCalls).toEqual([]);
  });
});
