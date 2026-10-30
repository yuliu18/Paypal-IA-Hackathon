import { checkoutUrls } from '@/lib/shop/checkout';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { payPalCaptureLookup } from '@/lib/guard/adapters/paypal-capture-lookup';
import { payPalOrderBinder } from '@/lib/guard/adapters/paypal-order-binder';
import { SHOP_CATALOGUE } from '@/lib/shop/catalogue';

const payPalToolkit = vi.fn(async (actions: unknown) => ({ toolkit: actions }));
const createPaymentGuard = vi.fn((deps: unknown) => ({ guard: deps }));
const runSalesAgent = vi.fn();
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
vi.mock('./sales-agent', () => ({ runSalesAgent: (options: unknown) => runSalesAgent(options) }));

const { handleSalesChat, SALES_ACTIONS, SALES_POLICY } = await import('./handle-sales-chat');

const chat = { customerEmail: 'ana@example.com', message: 'Two ceramic mug sets, please.' };
const shopOrigin = 'https://shop.example';
const guardDeps = () => createPaymentGuard.mock.calls[0][0] as Record<string, unknown>;
const agentOptions = () => runSalesAgent.mock.calls[0][0] as Record<string, unknown>;

describe('handleSalesChat', () => {
  afterEach(() => {
    payPalToolkit.mockClear();
    createPaymentGuard.mockClear();
    runSalesAgent.mockReset();
  });

  it('gives the agent the order create and get tools only, never the capture (pay_order)', async () => {
    runSalesAgent.mockResolvedValue({ reply: 'Done', steps: [] });

    await handleSalesChat(chat, 'careful', { shopOrigin });

    expect(SALES_ACTIONS).toEqual({ orders: { create: true, get: true } });
    expect(payPalToolkit).toHaveBeenCalledTimes(1);
    expect(payPalToolkit).toHaveBeenCalledWith(SALES_ACTIONS);
  });

  it('puts the guard in front of the toolkit with the writer as mandate, the sales policy and the catalogue, shop origin and order binder', async () => {
    runSalesAgent.mockResolvedValue({ reply: 'Done', steps: [] });

    await handleSalesChat(chat, 'careful', { shopOrigin });

    expect(guardDeps()).toMatchObject({
      upstream: 'client:payment-guard',
      task: { mandate: { customerEmail: 'ana@example.com' }, instructions: SALES_POLICY, untrustedInput: chat.message },
      judge: 'JUDGE',
      captures: payPalCaptureLookup,
      orders: { catalogue: SHOP_CATALOGUE, shopOrigin, checkout: checkoutUrls(shopOrigin), binder: payPalOrderBinder },
      audit: 'AUDIT',
      limits: shop.limits,
      notifier: 'NOTIFIER',
    });
    expect(agentOptions()).toMatchObject({ chat: 'AGENT_CHAT', tools: 'client:sales-agent', task: chat, instructions: SALES_POLICY, shopOrigin });
  });

  it('defaults the shop origin to APP_URL or the local dev server', async () => {
    runSalesAgent.mockResolvedValue({ reply: 'Done', steps: [] });
    const previous = process.env.APP_URL;
    delete process.env.APP_URL;
    try {
      await handleSalesChat(chat);
    } finally {
      if (previous !== undefined) process.env.APP_URL = previous;
    }

    expect((guardDeps().orders as { shopOrigin: string }).shopOrigin).toBe('http://localhost:3000');
    expect(agentOptions().shopOrigin).toBe('http://localhost:3000');
  });

  it('lifts only the daily cap for evaluation runs', async () => {
    runSalesAgent.mockResolvedValue({ reply: 'Done', steps: [] });

    await handleSalesChat(chat, 'careful', { shopOrigin, liftDailyCap: true });

    expect(guardDeps().limits).toEqual({ ...shop.limits, daily: { minor: Number.MAX_SAFE_INTEGER, currency: 'USD' } });
  });

  it('runs the vulnerable agent with instructions that trust the customer, while the guard keeps the sales policy', async () => {
    runSalesAgent.mockResolvedValue({ reply: 'Done', steps: [] });

    await handleSalesChat(chat, 'vulnerable', { shopOrigin });

    expect(agentOptions().instructions).not.toBe(SALES_POLICY);
    expect(agentOptions().instructions).toMatch(/authorized/i);
    expect(guardDeps().task).toMatchObject({ instructions: SALES_POLICY });
  });

  it('states the shop’s discount rule: no discount unless the shop states a promotion', () => {
    expect(SALES_POLICY).toMatch(/no discount/i);
    expect(SALES_POLICY).toMatch(/catalogue price/i);
    expect(SALES_POLICY).toMatch(/only for the customer who writes/i);
  });

  it('masks card numbers in the message and other people’s emails in the reply, keeping the PayPal approval link', async () => {
    const link = 'https://www.sandbox.paypal.com/checkoutnow?token=5O190127TN364715T';
    runSalesAgent.mockResolvedValue({ reply: `Pay here: ${link} (copy to thief@outside.example)`, steps: [] });

    const result = await handleSalesChat({ customerEmail: 'ana@example.com', message: 'My card is 4111 1111 1111 1111. Two mug sets.' }, 'careful', { shopOrigin });

    expect(agentOptions().task).toMatchObject({ message: expect.not.stringContaining('4111 1111 1111 1111') });
    expect(guardDeps().task).toMatchObject({ untrustedInput: expect.not.stringContaining('4111 1111 1111 1111') });
    expect(result.reply).toContain(link);
    expect(result.reply).not.toContain('thief@outside.example');
    expect(result.redacted).toEqual({ ticket: 1, reply: 1 });
  });
});
