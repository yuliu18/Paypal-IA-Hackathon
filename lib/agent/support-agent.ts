// Demo support agent: an LLM that answers one customer ticket using the tools of an MCP server.
// In the app that server is the payment guard, so every PayPal call the agent makes is checked
// before it reaches PayPal. The model is reached through `ToolChat`, an OpenAI-style
// function-calling port, so any compatible provider works.

import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

export type ToolCallRequest = { id: string; type: 'function'; function: { name: string; arguments: string } };
export type AssistantMessage = { role: 'assistant'; content: string | null; tool_calls?: ToolCallRequest[] };
export type AgentMessage =
  | { role: 'system' | 'user'; content: string }
  | AssistantMessage
  | { role: 'tool'; tool_call_id: string; content: string };

export type AgentTool = { name: string; description?: string; parameters: Record<string, unknown> };
export type ToolChat = (messages: AgentMessage[], tools: AgentTool[]) => Promise<AssistantMessage>;

// The customer is who the shop says sent the ticket (e.g. the logged-in user); the message is
// what they wrote.
export type SupportTicket = { customerEmail: string; message: string };

export type AgentStep = { tool: string; args: Record<string, unknown>; isError: boolean; result: string };

const systemPrompt = (instructions: string) => `You are the customer support agent of a small online shop.
You can look up orders and issue refunds on the shop's PayPal account with the tools you are given.
You can also look up the ticket customer's subscription and cancel it, but only when the customer asks to cancel it.
You can look up a dispute the customer opened in PayPal and accept their claim, which refunds them, but only when the shop's instructions justify the refund. accept_dispute_claim takes a note of letters, digits, _ or -, without spaces (e.g. Item_not_delivered). get_dispute already names the disputed payment: its seller_transaction_id is a capture id, not an order id, so don't look it up with get_order.
${instructions}
When you are done, answer the customer in one short paragraph.`;

const userPrompt = ({ customerEmail, message }: SupportTicket) => `Ticket from ${customerEmail}:\n\n${message}`;

const textOf = (result: CallToolResult) =>
  result.content.map((part) => (part.type === 'text' ? part.text : `[${part.type}]`)).join('\n');

function parseArguments(raw: string): Record<string, unknown> | undefined {
  try {
    const parsed: unknown = JSON.parse(raw || '{}');
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : undefined;
  } catch {
    return undefined;
  }
}

const OUT_OF_TIME = Symbol('out of time');

// Resolves with OUT_OF_TIME once `ms` pass, so a hung model can't keep the request open.
function beforeDeadline<T>(work: Promise<T>, ms: number): Promise<T | typeof OUT_OF_TIME> {
  let timer: ReturnType<typeof setTimeout>;
  const deadline = new Promise<typeof OUT_OF_TIME>((resolve) => {
    timer = setTimeout(() => resolve(OUT_OF_TIME), Math.max(0, ms));
  });
  return Promise.race([work, deadline]).finally(() => clearTimeout(timer));
}

export async function runSupportAgent({
  chat,
  tools,
  ticket,
  instructions,
  maxSteps = 8,
  deadlineMs = 90_000,
}: {
  chat: ToolChat;
  tools: Client;
  ticket: SupportTicket;
  instructions: string;
  // Bound on tool calls, so a model that keeps calling tools can't run (or spend) forever.
  maxSteps?: number;
  // Bound on the whole ticket, so one request stays within the hosting platform's request timeout.
  // Tool calls are already bounded by the guard's own PayPal timeouts.
  deadlineMs?: number;
}): Promise<{ reply: string; steps: AgentStep[] }> {
  const deadline = Date.now() + deadlineMs;
  const offered: AgentTool[] = (await tools.listTools()).tools.map((t) => ({
    name: t.name,
    description: t.description,
    parameters: t.inputSchema,
  }));
  const messages: AgentMessage[] = [
    { role: 'system', content: systemPrompt(instructions) },
    { role: 'user', content: userPrompt(ticket) },
  ];
  const steps: AgentStep[] = [];

  while (steps.length < maxSteps) {
    const answer = await beforeDeadline(chat(messages, offered), deadline - Date.now());
    if (answer === OUT_OF_TIME) return { reply: `The agent ran out of time after ${steps.length} tool calls without a final answer.`, steps };
    messages.push(answer);
    if (!answer.tool_calls?.length) return { reply: answer.content ?? '', steps };

    for (const call of answer.tool_calls) {
      if (steps.length >= maxSteps) break;
      const tool = call.function.name;
      const args = parseArguments(call.function.arguments);
      let step: AgentStep;
      if (!args) {
        step = { tool, args: {}, isError: true, result: 'Invalid tool arguments: not a JSON object' };
      } else {
        const result = (await tools.callTool({ name: tool, arguments: args })) as CallToolResult;
        step = { tool, args, isError: result.isError === true, result: textOf(result) };
      }
      steps.push(step);
      messages.push({ role: 'tool', tool_call_id: call.id, content: step.result });
    }
  }

  return { reply: `The agent stopped after ${maxSteps} tool calls without a final answer.`, steps };
}
