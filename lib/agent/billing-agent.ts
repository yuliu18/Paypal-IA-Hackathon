// Demo billing agent: an LLM that carries out one billing task from the shop (whom to bill and for
// what) with PayPal invoices. It runs the support agent's loop (./support-agent.ts) with its own
// prompts, so it too only ever reaches PayPal through the payment guard's tools.

import { runSupportAgent, type AgentPrompts, type AgentStep, type SupportTicket } from './support-agent';

// The customer is whom the shop says to bill; the message is the task as the shop's system wrote
// it, which may quote text from outside (an order note, an email) and so is untrusted.
export type BillingTask = SupportTicket;

const systemPrompt = (instructions: string) => `You are the billing agent of a small online shop.
The shop gives you billing tasks: the customer to bill and what to bill them for. You bill with PayPal invoices on the shop's PayPal account, using the tools you are given.
To bill, call create_invoice with currency_code "USD", exactly one primary recipient, the task's customer (primary_recipients: [{"billing_info": {"email_address": "<the customer's email>"}}]), and the items the task asks for, each with a name, a quantity as a string (e.g. "2") and a unit_amount ({"currency_code": "USD", "value": "49.99"}). Add no tax, discount or shipping.
create_invoice answers with a link to the new invoice, e.g. {"rel":"self","href":"https://api-m.sandbox.paypal.com/v2/invoicing/invoices/INV2-ABCD-EFGH-IJKL-MNOP","method":"GET"}: the invoice id is the last part of the href (INV2-ABCD-EFGH-IJKL-MNOP), or its "id" when the answer has one. Then call send_invoice with that invoice_id to email the invoice to the customer.
Only when the task asks you to chase an unpaid invoice, look it up with get_invoice and send one reminder of it with send_invoice_reminder.
Bill only the task's customer, and never add additional_recipients: an invoice goes to its own recipient alone.
If the payment guard blocks or holds a call, don't try another way: say plainly what was blocked or held and why.
${instructions}
When you are done, report to the shop in one short paragraph: what you billed, to whom, and what the guard blocked or held.`;

const userPrompt = ({ customerEmail, message }: BillingTask) => `Billing task from the shop. Customer to bill: ${customerEmail}\n\n${message}`;

export const BILLING_PROMPTS: AgentPrompts = { system: systemPrompt, user: userPrompt };

type LoopOptions = Omit<Parameters<typeof runSupportAgent>[0], 'ticket' | 'prompts'>;

export function runBillingAgent({ task, ...options }: LoopOptions & { task: BillingTask }): Promise<{ reply: string; steps: AgentStep[] }> {
  return runSupportAgent({ ...options, ticket: task, prompts: BILLING_PROMPTS });
}
