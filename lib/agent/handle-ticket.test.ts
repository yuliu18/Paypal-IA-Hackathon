import { checkoutUrls } from '@/lib/shop/checkout';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { payPalCaptureLookup } from '@/lib/guard/adapters/paypal-capture-lookup';
import { payPalDisputeLookup } from '@/lib/guard/adapters/paypal-dispute-lookup';
import { payPalInvoiceLookup } from '@/lib/guard/adapters/paypal-invoice-lookup';
import { payPalOrderBinder } from '@/lib/guard/adapters/paypal-order-binder';
import { payPalSubscriptionLookup } from '@/lib/guard/adapters/paypal-subscription-lookup';
import { seedCustomerDirectory } from '@/lib/guard/adapters/seed-customer-directory';
import { SHOP_CATALOGUE } from '@/lib/shop/catalogue';

const toolkitActions = vi.fn();
const toolkitSetup = vi.fn();
const decideHeldCall = vi.fn();
const accessToken = vi.fn(async (environment?: string) => `TOKEN-${environment ?? 'sandbox'}`);
const limits = { approvalThreshold: { minor: 10_000, currency: 'USD' }, perRefund: { minor: 25_000, currency: 'USD' }, daily: { minor: 20_000, currency: 'USD' } };
let shop: Record<string, unknown> = { limits, mode: 'test', paypalLive: { clientId: '', secret: '' } };
let heldEnvironment: 'sandbox' | 'live' | undefined;
const AUDIT = { get: async (id: string) => ({ id, environment: heldEnvironment }) };

vi.mock('@paypal/agent-toolkit/mcp', () => ({
  PayPalAgentToolkit: class {
    constructor({ accessToken, configuration }: { accessToken: string; configuration: { actions: unknown; context: unknown } }) {
      toolkitActions(configuration.actions);
      toolkitSetup({ accessToken, context: configuration.context });
    }
  },
}));
vi.mock('@/lib/paypal', async (original) => ({ ...(await original<object>()), accessToken: (environment?: string) => accessToken(environment) }));
vi.mock('@/lib/settings/settings', () => ({ loadSettings: async () => shop }));
vi.mock('@/lib/guard/guard', () => ({ decideHeldCall: (...args: unknown[]) => decideHeldCall(...args) }));
vi.mock('@/lib/guard/runtime', () => ({ auditLog: () => AUDIT }));
vi.mock('./in-memory-mcp', () => ({ withClient: (_server: unknown, name: string, work: (client: unknown) => unknown) => work(`client:${name}`) }));

const { decideHeld, llmConfig } = await import('./handle-ticket');

const deps = () => decideHeldCall.mock.calls[0][0] as Record<string, unknown>;

describe('decideHeld', () => {
  afterEach(() => {
    toolkitActions.mockReset();
    toolkitSetup.mockReset();
    decideHeldCall.mockReset();
    accessToken.mockClear();
    heldEnvironment = undefined;
    shop = { limits, mode: 'test', paypalLive: { clientId: '', secret: '' } };
    vi.unstubAllEnvs();
  });

  it('still runs held refunds, cancellations, dispute acceptances and invoice actions with their lookups', async () => {
    decideHeldCall.mockResolvedValue({ outcome: 'executed', message: 'ok' });

    expect(await decideHeld('7', true)).toEqual({ outcome: 'executed', message: 'ok' });

    expect(toolkitActions).toHaveBeenCalledWith(
      expect.objectContaining({
        payments: { createRefund: true },
        subscriptions: { show: true, cancel: true },
        disputes: { get: true, create: true },
        invoices: { create: true, get: true, send: true, sendReminder: true },
      }),
    );
    expect(deps()).toMatchObject({
      upstream: 'client:payment-guard-approval',
      captures: payPalCaptureLookup,
      subscriptions: payPalSubscriptionLookup,
      disputes: payPalDisputeLookup,
      invoices: payPalInvoiceLookup,
      customers: seedCustomerDirectory,
      audit: expect.objectContaining({ environment: 'sandbox', log: AUDIT }),
      limits,
    });
    expect(toolkitSetup).toHaveBeenCalledWith({ accessToken: 'TOKEN-sandbox', context: { sandbox: true } });
    expect(decideHeldCall.mock.calls[0].slice(1)).toEqual(['7', true]);
  });

  it('can run a held order: the toolkit creates orders and the guard gets the catalogue, the shop origin and the order binder', async () => {
    decideHeldCall.mockResolvedValue({ outcome: 'executed', message: 'Order created' });

    await decideHeld('9', true, { shopOrigin: 'https://shop.example' });

    expect(toolkitActions.mock.calls[0][0]).toMatchObject({ orders: { get: true, create: true } });
    expect(toolkitActions.mock.calls[0][0].orders).not.toHaveProperty('capture');
    expect(deps().orders).toEqual({ catalogue: SHOP_CATALOGUE, shopOrigin: 'https://shop.example', checkout: checkoutUrls('https://shop.example'), binder: payPalOrderBinder });
  });

  it('approves a live hold on live PayPal while live mode is on', async () => {
    vi.stubEnv('ALLOW_LIVE_MODE', 'true');
    shop = { limits, mode: 'live', paypalLive: { clientId: 'live-id', secret: 'live-secret' } };
    heldEnvironment = 'live';
    decideHeldCall.mockResolvedValue({ outcome: 'executed', message: 'ok' });

    await decideHeld('7', true);

    expect(toolkitSetup).toHaveBeenCalledWith({ accessToken: 'TOKEN-live', context: { sandbox: false } });
    expect(deps().audit).toMatchObject({ environment: 'live' });
    expect(deps().captures).not.toBe(payPalCaptureLookup);
  });

  it.each([
    ['the server flag is gone', { mode: 'live', paypalLive: { clientId: 'live-id', secret: 'live-secret' } }, undefined],
    ['the owner switched back to test', { mode: 'test', paypalLive: { clientId: 'live-id', secret: 'live-secret' } }, 'true'],
  ])('refuses to approve a live hold when %s, without a token or a PayPal call', async (_why, settings, allow) => {
    if (allow) vi.stubEnv('ALLOW_LIVE_MODE', allow);
    shop = { limits, ...settings };
    heldEnvironment = 'live';

    const result = await decideHeld('7', true);

    expect(result.outcome).toBe('refused');
    expect(result.message).toContain('live mode is off');
    expect(accessToken).not.toHaveBeenCalled();
    expect(decideHeldCall).not.toHaveBeenCalled();
  });

  it('can still reject a live hold after live mode was turned off, recorded as live, with no token', async () => {
    heldEnvironment = 'live';
    decideHeldCall.mockResolvedValue({ outcome: 'blocked', message: 'rejected' });

    expect(await decideHeld('7', false)).toEqual({ outcome: 'blocked', message: 'rejected' });

    expect(accessToken).not.toHaveBeenCalled();
    expect(toolkitSetup.mock.calls[0][0].context).toEqual({ sandbox: true });
    expect(deps().audit).toMatchObject({ environment: 'live' });
  });

  it('keeps a sandbox hold on the sandbox even in live mode', async () => {
    vi.stubEnv('ALLOW_LIVE_MODE', 'true');
    shop = { limits, mode: 'live', paypalLive: { clientId: 'live-id', secret: 'live-secret' } };
    heldEnvironment = 'sandbox';
    decideHeldCall.mockResolvedValue({ outcome: 'executed', message: 'ok' });

    await decideHeld('7', true);

    expect(accessToken).toHaveBeenCalledWith('sandbox');
    expect(toolkitSetup).toHaveBeenCalledWith({ accessToken: 'TOKEN-sandbox', context: { sandbox: true } });
    expect(deps().audit).toMatchObject({ environment: 'sandbox' });
  });
});

describe('llmConfig', () => {
  const ai = { provider: 'ollama', baseUrl: 'http://localhost:11434/v1', apiKey: 'ollama', agentModel: 'qwen3', judgeModel: '' };

  it('waits longer for a model on this machine, and as before for a hosted one', async () => {
    const { CLOUD_TIMEOUTS, LOCAL_TIMEOUTS } = await import('@/lib/llm/timeouts');

    expect((await llmConfig(ai)).timeouts).toBe(LOCAL_TIMEOUTS);
    expect((await llmConfig({ ...ai, provider: 'openai', baseUrl: 'https://api.openai.com/v1', apiKey: 'sk-test' })).timeouts).toBe(CLOUD_TIMEOUTS);
  });
});
