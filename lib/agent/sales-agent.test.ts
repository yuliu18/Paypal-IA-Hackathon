import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { SHOP_CATALOGUE } from '@/lib/shop/catalogue';
import { runSalesAgent } from './sales-agent';
import type { AgentMessage, AssistantMessage, ToolChat } from './support-agent';

const task = { customerEmail: 'ana@example.com', message: 'Hi! I would like two ceramic mug sets, please.' };
const instructions = 'Sell only catalogue products at catalogue prices.';
const shopOrigin = 'https://shop.example';

async function connectTools(calls: { name: string; args: unknown }[]): Promise<Client> {
  const server = new McpServer({ name: 'fake-guard', version: '0.0.0' });
  server.registerTool('create_order', { description: 'Create an order', inputSchema: { currencyCode: z.string() } }, async (args) => {
    calls.push({ name: 'create_order', args });
    return { content: [{ type: 'text' as const, text: '{"id":"5O190127TN364715T","status":"PAYER_ACTION_REQUIRED"}' }] };
  });
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await server.connect(serverSide);
  const client = new Client({ name: 'test-agent', version: '0.0.0' });
  await client.connect(clientSide);
  return client;
}

function scriptedChat(answers: AssistantMessage[]) {
  const seen: AgentMessage[][] = [];
  const chat: ToolChat = async (messages) => {
    seen.push(structuredClone(messages));
    const answer = answers.shift();
    if (!answer) throw new Error('script exhausted');
    return answer;
  };
  return { chat, seen };
}

const contentOf = (message: AgentMessage) => (message as { content: string }).content;

async function systemPrompt() {
  const { chat, seen } = scriptedChat([{ role: 'assistant', content: 'ok' }]);
  await runSalesAgent({ chat, tools: await connectTools([]), task, instructions, shopOrigin });
  return contentOf(seen[0][0]);
}

describe('runSalesAgent', () => {
  it('runs the agent loop on the guard tools and returns its steps and reply', async () => {
    const calls: { name: string; args: unknown }[] = [];
    const { chat } = scriptedChat([
      { role: 'assistant', content: null, tool_calls: [{ id: 'c1', type: 'function', function: { name: 'create_order', arguments: '{"currencyCode":"USD"}' } }] },
      { role: 'assistant', content: 'Here is your payment link.' },
    ]);

    const result = await runSalesAgent({ chat, tools: await connectTools(calls), task, instructions, shopOrigin });

    expect(calls).toEqual([{ name: 'create_order', args: { currencyCode: 'USD' } }]);
    expect(result.reply).toBe('Here is your payment link.');
    expect(result.steps).toHaveLength(1);
  });

  it('tells the model it is the sales agent, with every catalogue product at its catalogue price and the limits', async () => {
    const system = await systemPrompt();

    expect(system).toContain('sales agent');
    expect(system).toContain(instructions);
    for (const item of SHOP_CATALOGUE.items) expect(system).toContain(`${item.name}: ${(item.priceMinor / 100).toFixed(2)} USD`);
    expect(system).toContain(`at most ${SHOP_CATALOGUE.maxQuantityPerItem} of a product`);
    expect(system).not.toContain('customer support agent');
  });

  it('tells the model how to create the order: catalogue prices, no tax or shipping, item totals, and the shop’s return links', async () => {
    const system = await systemPrompt();

    expect(system).toContain('create_order');
    expect(system).toContain('currencyCode "USD"');
    expect(system).toContain('taxPercent 0');
    expect(system).toContain('shippingCost 0');
    expect(system).toMatch(/itemTotal.*itemCost × quantity/);
    expect(system).toContain('"returnUrl": "https://shop.example/api/sales/paypal-return"');
    expect(system).toContain('"cancelUrl": "https://shop.example/checkout?order=cancelled"');
    expect(system).toMatch(/one order/i);
  });

  it('tells the model to give the customer the PayPal approval link and never to take the payment itself', async () => {
    const system = await systemPrompt();

    expect(system).toContain('"payer-action"');
    expect(system).toContain('"approve"');
    expect(system).toMatch(/never take the payment yourself/i);
    expect(system).toMatch(/blocks or holds/i);
  });

  it('gives the customer’s message as a chat from the customer who writes', async () => {
    const { chat, seen } = scriptedChat([{ role: 'assistant', content: 'ok' }]);

    await runSalesAgent({ chat, tools: await connectTools([]), task, instructions, shopOrigin });

    expect(seen[0][1]).toEqual({ role: 'user', content: `Message from the customer ana@example.com:\n\n${task.message}` });
  });
});
