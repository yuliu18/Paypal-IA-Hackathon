import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { runBillingAgent } from './billing-agent';
import type { AgentMessage, AssistantMessage, ToolChat } from './support-agent';

const task = { customerEmail: 'ana@example.com', message: 'Ana ordered two more mug sets at 49.99 USD each. Invoice her and send it.' };
const instructions = 'Bill a customer only for what the task asks.';

async function connectTools(calls: { name: string; args: unknown }[]): Promise<Client> {
  const server = new McpServer({ name: 'fake-guard', version: '0.0.0' });
  server.registerTool('create_invoice', { description: 'Create an invoice', inputSchema: { currency_code: z.string() } }, async (args) => {
    calls.push({ name: 'create_invoice', args });
    return { content: [{ type: 'text' as const, text: '{"rel":"self","href":"https://api-m.sandbox.paypal.com/v2/invoicing/invoices/INV2-AAAA-BBBB","method":"GET"}' }] };
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

describe('runBillingAgent', () => {
  it('runs the agent loop on the guard tools and returns its steps and report', async () => {
    const calls: { name: string; args: unknown }[] = [];
    const { chat } = scriptedChat([
      { role: 'assistant', content: null, tool_calls: [{ id: 'c1', type: 'function', function: { name: 'create_invoice', arguments: '{"currency_code":"USD"}' } }] },
      { role: 'assistant', content: 'Invoiced Ana.' },
    ]);

    const result = await runBillingAgent({ chat, tools: await connectTools(calls), task, instructions });

    expect(calls).toEqual([{ name: 'create_invoice', args: { currency_code: 'USD' } }]);
    expect(result.reply).toBe('Invoiced Ana.');
    expect(result.steps).toHaveLength(1);
  });

  it('tells the model it is the billing agent, how to bill and send, and the shop instructions', async () => {
    const { chat, seen } = scriptedChat([{ role: 'assistant', content: 'ok' }]);

    await runBillingAgent({ chat, tools: await connectTools([]), task, instructions });

    const system = contentOf(seen[0][0]);
    expect(seen[0][0].role).toBe('system');
    expect(system).toContain('billing agent');
    expect(system).toContain(instructions);
    expect(system).toContain('create_invoice');
    expect(system).toContain('send_invoice');
    expect(system).toMatch(/exactly one primary recipient/i);
    expect(system).toMatch(/no tax/i);
    // The new invoice's id is the last path segment of the href create_invoice answers with.
    expect(system).toContain('href');
    expect(system).toContain('INV2-');
    expect(system).toMatch(/only when the task asks you to chase an unpaid invoice/i);
    expect(system).toContain('send_invoice_reminder');
    expect(system).toMatch(/never add additional_recipients/i);
    expect(system).toMatch(/blocks or holds/i);
    expect(system).not.toContain('customer support agent');
  });

  it('gives the task as a task from the shop that names the customer to bill', async () => {
    const { chat, seen } = scriptedChat([{ role: 'assistant', content: 'ok' }]);

    await runBillingAgent({ chat, tools: await connectTools([]), task, instructions });

    expect(seen[0][1]).toEqual({ role: 'user', content: `Billing task from the shop. Customer to bill: ana@example.com\n\n${task.message}` });
  });
});
