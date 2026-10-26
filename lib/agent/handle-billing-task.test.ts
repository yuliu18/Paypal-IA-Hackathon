import { afterEach, describe, expect, it, vi } from 'vitest';
import { payPalCaptureLookup } from '@/lib/guard/adapters/paypal-capture-lookup';
import { payPalInvoiceLookup } from '@/lib/guard/adapters/paypal-invoice-lookup';
import { seedCustomerDirectory } from '@/lib/guard/adapters/seed-customer-directory';

const payPalToolkit = vi.fn(async (actions: unknown) => ({ toolkit: actions }));
const createPaymentGuard = vi.fn((deps: unknown) => ({ guard: deps }));
const runBillingAgent = vi.fn();
const shop = {
  ai: {},
  limits: { approvalThreshold: { minor: 10_000, currency: 'USD' }, perRefund: { minor: 25_000, currency: 'USD' }, daily: { minor: 20_000, currency: 'USD' } },
  business: { refundPolicy: 'Refund damaged items only.', contactEmails: ['shop@example.com'] },
  notifications: {},
};

vi.mock('./handle-ticket', () => ({
  llmConfig: async () => ({ baseUrl: 'https://llm.test', apiKey: 'k', agentModel: 'agent-m', judgeModel: 'judge-m', headers: {} }),
  payPalToolkit: (actions: unknown) => payPalToolkit(actions),
  heldNotifier: () => 'NOTIFIER',
}));
vi.mock('@/lib/settings/settings', () => ({ loadSettings: async () => shop }));
vi.mock('@/lib/guard/guard', () => ({ createPaymentGuard: (deps: unknown) => createPaymentGuard(deps) }));
vi.mock('@/lib/guard/runtime', () => ({ auditLog: () => 'AUDIT' }));
vi.mock('@/lib/guard/adapters/llm-intent-judge', () => ({ createLlmIntentJudge: () => 'JUDGE', openAiCompatibleChat: () => 'JUDGE_CHAT' }));
vi.mock('./openai-tool-chat', () => ({ openAiCompatibleToolChat: () => 'AGENT_CHAT' }));
vi.mock('./in-memory-mcp', () => ({ withClient: (_server: unknown, name: string, work: (client: unknown) => unknown) => work(`client:${name}`) }));
vi.mock('./billing-agent', () => ({ runBillingAgent: (options: unknown) => runBillingAgent(options) }));

const { handleBillingTask, BILLING_ACTIONS, BILLING_POLICY } = await import('./handle-billing-task');

const task = { customerEmail: 'ana@example.com', message: 'Ana ordered two more mug sets at 49.99 USD each. Invoice her and send it.' };
const guardDeps = () => createPaymentGuard.mock.calls[0][0] as Record<string, unknown>;
const agentOptions = () => runBillingAgent.mock.calls[0][0] as Record<string, unknown>;

describe('handleBillingTask', () => {
  afterEach(() => {
    payPalToolkit.mockClear();
    createPaymentGuard.mockClear();
    runBillingAgent.mockReset();
  });

  it('gives the agent the invoice tools only', async () => {
    runBillingAgent.mockResolvedValue({ reply: 'Done', steps: [] });

    await handleBillingTask(task);

    expect(BILLING_ACTIONS).toEqual({ invoices: { create: true, get: true, send: true, sendReminder: true } });
    expect(payPalToolkit).toHaveBeenCalledTimes(1);
    expect(payPalToolkit).toHaveBeenCalledWith(BILLING_ACTIONS);
  });

  it('puts the guard in front of the toolkit with the task customer as mandate and the invoice lookups', async () => {
    runBillingAgent.mockResolvedValue({ reply: 'Done', steps: [] });

    await handleBillingTask(task);

    expect(guardDeps()).toMatchObject({
      upstream: 'client:payment-guard',
      task: { mandate: { customerEmail: 'ana@example.com' }, instructions: BILLING_POLICY, untrustedInput: task.message },
      judge: 'JUDGE',
      captures: payPalCaptureLookup,
      invoices: payPalInvoiceLookup,
      customers: seedCustomerDirectory,
      audit: 'AUDIT',
      limits: shop.limits,
      notifier: 'NOTIFIER',
    });
    expect(agentOptions()).toMatchObject({ chat: 'AGENT_CHAT', tools: 'client:billing-agent', task, instructions: BILLING_POLICY });
  });

  it('runs the vulnerable agent with instructions that obey the task, while the guard keeps the billing policy', async () => {
    runBillingAgent.mockResolvedValue({ reply: 'Done', steps: [] });

    await handleBillingTask(task, 'vulnerable');

    expect(agentOptions().instructions).not.toBe(BILLING_POLICY);
    expect(agentOptions().instructions).toMatch(/authorized order/i);
    expect(guardDeps().task).toMatchObject({ instructions: BILLING_POLICY });
  });

  it('masks card numbers in the task before anyone sees it and other people’s emails in the report', async () => {
    runBillingAgent.mockResolvedValue({ reply: 'Invoiced ana@example.com, copy to thief@outside.example.', steps: [{ tool: 'create_invoice', args: {}, isError: false, result: '{}' }] });

    const result = await handleBillingTask({ customerEmail: 'ana@example.com', message: 'Card 4111 1111 1111 1111 on file. Invoice her.' });

    expect(agentOptions().task).toMatchObject({ message: expect.not.stringContaining('4111 1111 1111 1111') });
    expect(guardDeps().task).toMatchObject({ untrustedInput: expect.not.stringContaining('4111 1111 1111 1111') });
    expect(result.reply).toContain('ana@example.com');
    expect(result.reply).not.toContain('thief@outside.example');
    expect(result.steps).toEqual([{ tool: 'create_invoice', args: {}, isError: false, result: '{}' }]);
    expect(result.redacted).toEqual({ ticket: 1, reply: 1 });
  });
});
