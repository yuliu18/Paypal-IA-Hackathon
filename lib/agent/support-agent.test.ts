import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { runSupportAgent, type AgentMessage, type AssistantMessage, type ToolChat } from './support-agent';

const ticket = { customerEmail: 'ana@example.com', message: 'My mug from order ORD-1 arrived broken.' };
const instructions = 'Refund damaged items only.';

let toolCalls: { name: string; args: unknown }[];

async function connectTools(): Promise<Client> {
  const server = new McpServer({ name: 'fake-guard', version: '0.0.0' });
  server.registerTool('get_order', { description: 'Get an order', inputSchema: { id: z.string() } }, async (args) => {
    toolCalls.push({ name: 'get_order', args });
    return { content: [{ type: 'text' as const, text: '{"capture_id":"CAP-1"}' }] };
  });
  server.registerTool('create_refund', { description: 'Refund a capture', inputSchema: { capture_id: z.string() } }, async (args) => {
    toolCalls.push({ name: 'create_refund', args });
    return { isError: true, content: [{ type: 'text' as const, text: 'Blocked by payment guard. CUSTOMER_MISMATCH: not yours' }] };
  });
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await server.connect(serverSide);
  const client = new Client({ name: 'test-agent', version: '0.0.0' });
  await client.connect(clientSide);
  return client;
}

const callTool = (id: string, name: string, args: unknown): AssistantMessage => ({
  role: 'assistant',
  content: null,
  tool_calls: [{ id, type: 'function', function: { name, arguments: typeof args === 'string' ? args : JSON.stringify(args) } }],
});
const say = (content: string): AssistantMessage => ({ role: 'assistant', content });

// A scripted model: returns the queued answers in order and records what it was sent.
function scriptedChat(answers: AssistantMessage[]) {
  const seen: { messages: AgentMessage[]; tools: string[] }[] = [];
  const chat: ToolChat = async (messages, tools) => {
    seen.push({ messages: structuredClone(messages), tools: tools.map((t) => t.name) });
    const answer = answers.shift();
    if (!answer) throw new Error('script exhausted');
    return answer;
  };
  return { chat, seen };
}

beforeEach(() => {
  toolCalls = [];
});

describe('runSupportAgent', () => {
  it('offers the guard tools, runs the calls the model makes and returns its final reply', async () => {
    const { chat, seen } = scriptedChat([callTool('c1', 'get_order', { id: 'ORD-1' }), say('Your refund is on its way.')]);

    const result = await runSupportAgent({ chat, tools: await connectTools(), ticket, instructions });

    expect(toolCalls).toEqual([{ name: 'get_order', args: { id: 'ORD-1' } }]);
    expect(seen[0].tools).toEqual(['get_order', 'create_refund']);
    expect(result.reply).toBe('Your refund is on its way.');
    expect(result.steps).toEqual([{ tool: 'get_order', args: { id: 'ORD-1' }, isError: false, result: '{"capture_id":"CAP-1"}' }]);
  });

  it('gives the model the instructions as system prompt and the ticket with its customer as user message', async () => {
    const { chat, seen } = scriptedChat([say('ok')]);

    await runSupportAgent({ chat, tools: await connectTools(), ticket, instructions });

    const [system, user] = seen[0].messages;
    expect(system).toMatchObject({ role: 'system' });
    expect((system as { content: string }).content).toContain(instructions);
    expect(user).toMatchObject({ role: 'user' });
    expect((user as { content: string }).content).toContain('ana@example.com');
    expect((user as { content: string }).content).toContain(ticket.message);
  });

  it('tells the model it may cancel the ticket customer\'s subscription only when they ask', async () => {
    const { chat, seen } = scriptedChat([say('ok')]);

    await runSupportAgent({ chat, tools: await connectTools(), ticket, instructions });

    const system = (seen[0].messages[0] as { content: string }).content;
    expect(system).toMatch(/cancel/i);
    expect(system).toContain('subscription');
    expect(system).toMatch(/only when the customer asks/i);
  });

  // The billing agent reuses this loop with its own prompts: the support agent's must not change.
  it('keeps the support prompts word for word', async () => {
    const { chat, seen } = scriptedChat([say('ok')]);

    await runSupportAgent({ chat, tools: await connectTools(), ticket, instructions });

    expect(seen[0].messages.slice(0, 2)).toEqual([
      {
        role: 'system',
        content: `You are the customer support agent of a small online shop.
You can look up orders and issue refunds on the shop's PayPal account with the tools you are given.
You can also look up the ticket customer's subscription and cancel it, but only when the customer asks to cancel it.
You can look up a dispute the customer opened in PayPal and accept their claim, which refunds them, but only when the shop's instructions justify the refund. accept_dispute_claim takes a note of letters, digits, _ or -, without spaces (e.g. Item_not_delivered). get_dispute already names the disputed payment: its seller_transaction_id is a capture id, not an order id, so don't look it up with get_order.
Refund damaged items only.
When you are done, answer the customer in one short paragraph.`,
      },
      { role: 'user', content: 'Ticket from ana@example.com:\n\nMy mug from order ORD-1 arrived broken.' },
    ]);
  });

  it('runs with the prompts it is given instead of the support ones', async () => {
    const { chat, seen } = scriptedChat([say('ok')]);
    const prompts = { system: (i: string) => `SYSTEM ${i}`, user: (t: { customerEmail: string; message: string }) => `USER ${t.customerEmail} ${t.message}` };

    await runSupportAgent({ chat, tools: await connectTools(), ticket, instructions, prompts });

    expect(seen[0].messages.slice(0, 2)).toEqual([
      { role: 'system', content: 'SYSTEM Refund damaged items only.' },
      { role: 'user', content: 'USER ana@example.com My mug from order ORD-1 arrived broken.' },
    ]);
  });

  it('feeds each tool result back to the model under its call id', async () => {
    const { chat, seen } = scriptedChat([callTool('c1', 'get_order', { id: 'ORD-1' }), say('done')]);

    await runSupportAgent({ chat, tools: await connectTools(), ticket, instructions });

    expect(seen[1].messages.slice(-2)).toEqual([
      callTool('c1', 'get_order', { id: 'ORD-1' }),
      { role: 'tool', tool_call_id: 'c1', content: '{"capture_id":"CAP-1"}' },
    ]);
  });

  it('reports a blocked call as an error step and lets the model answer the customer', async () => {
    const { chat, seen } = scriptedChat([callTool('c1', 'create_refund', { capture_id: 'CAP-9' }), say('I cannot refund that order.')]);

    const result = await runSupportAgent({ chat, tools: await connectTools(), ticket, instructions });

    expect(result.steps).toEqual([
      { tool: 'create_refund', args: { capture_id: 'CAP-9' }, isError: true, result: 'Blocked by payment guard. CUSTOMER_MISMATCH: not yours' },
    ]);
    expect(seen[1].messages.at(-1)).toEqual({ role: 'tool', tool_call_id: 'c1', content: 'Blocked by payment guard. CUSTOMER_MISMATCH: not yours' });
    expect(result.reply).toBe('I cannot refund that order.');
  });

  it('returns malformed tool arguments to the model as an error without calling the tool', async () => {
    const { chat, seen } = scriptedChat([callTool('c1', 'create_refund', '{not json'), say('sorry')]);

    const result = await runSupportAgent({ chat, tools: await connectTools(), ticket, instructions });

    expect(toolCalls).toEqual([]);
    expect(result.steps).toEqual([{ tool: 'create_refund', args: {}, isError: true, result: 'Invalid tool arguments: not a JSON object' }]);
    expect(seen[1].messages.at(-1)).toEqual({ role: 'tool', tool_call_id: 'c1', content: 'Invalid tool arguments: not a JSON object' });
  });

  it('stops after maxSteps tool calls so a looping model cannot run forever', async () => {
    const loop = Array.from({ length: 10 }, (_, i) => callTool(`c${i}`, 'get_order', { id: 'ORD-1' }));
    const { chat } = scriptedChat(loop);

    const result = await runSupportAgent({ chat, tools: await connectTools(), ticket, instructions, maxSteps: 3 });

    expect(toolCalls).toHaveLength(3);
    expect(result.steps).toHaveLength(3);
    expect(result.reply).toBe('The agent stopped after 3 tool calls without a final answer.');
  });

  it('gives up when the model does not answer before the overall deadline', async () => {
    const chat: ToolChat = () => new Promise(() => undefined);
    const started = Date.now();

    const result = await runSupportAgent({ chat, tools: await connectTools(), ticket, instructions, deadlineMs: 50 });

    expect(Date.now() - started).toBeLessThan(1000);
    expect(result).toEqual({ reply: 'The agent ran out of time after 0 tool calls without a final answer.', steps: [] });
  });

  it('keeps the steps already taken when the deadline passes between model calls', async () => {
    let calls = 0;
    const chat: ToolChat = async () => {
      calls++;
      if (calls === 1) return callTool('c1', 'get_order', { id: 'ORD-1' });
      return new Promise(() => undefined);
    };

    const result = await runSupportAgent({ chat, tools: await connectTools(), ticket, instructions, deadlineMs: 50 });

    expect(result.steps).toHaveLength(1);
    expect(result.reply).toBe('The agent ran out of time after 1 tool calls without a final answer.');
  });
});
