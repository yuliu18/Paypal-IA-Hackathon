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
const decideHeldCall = vi.fn();
const limits = { approvalThreshold: { minor: 10_000, currency: 'USD' }, perRefund: { minor: 25_000, currency: 'USD' }, daily: { minor: 20_000, currency: 'USD' } };

vi.mock('@paypal/agent-toolkit/mcp', () => ({
  PayPalAgentToolkit: class {
    constructor({ configuration }: { configuration: { actions: unknown } }) {
      toolkitActions(configuration.actions);
    }
  },
}));
vi.mock('@/lib/paypal', async (original) => ({ ...(await original<object>()), accessToken: async () => 'TOKEN' }));
vi.mock('@/lib/settings/settings', () => ({ loadSettings: async () => ({ limits }) }));
vi.mock('@/lib/guard/guard', () => ({ decideHeldCall: (...args: unknown[]) => decideHeldCall(...args) }));
vi.mock('@/lib/guard/runtime', () => ({ auditLog: () => 'AUDIT' }));
vi.mock('./in-memory-mcp', () => ({ withClient: (_server: unknown, name: string, work: (client: unknown) => unknown) => work(`client:${name}`) }));

const { decideHeld } = await import('./handle-ticket');

const deps = () => decideHeldCall.mock.calls[0][0] as Record<string, unknown>;

describe('decideHeld', () => {
  afterEach(() => {
    toolkitActions.mockReset();
    decideHeldCall.mockReset();
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
      audit: 'AUDIT',
      limits,
    });
    expect(decideHeldCall.mock.calls[0].slice(1)).toEqual(['7', true]);
  });

  it('can run a held order: the toolkit creates orders and the guard gets the catalogue, the shop origin and the order binder', async () => {
    decideHeldCall.mockResolvedValue({ outcome: 'executed', message: 'Order created' });

    await decideHeld('9', true, { shopOrigin: 'https://shop.example' });

    expect(toolkitActions.mock.calls[0][0]).toMatchObject({ orders: { get: true, create: true } });
    expect(toolkitActions.mock.calls[0][0].orders).not.toHaveProperty('capture');
    expect(deps().orders).toEqual({ catalogue: SHOP_CATALOGUE, shopOrigin: 'https://shop.example', checkout: checkoutUrls('https://shop.example'), binder: payPalOrderBinder });
  });
});
