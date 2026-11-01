import { NextRequest } from 'next/server';
import { afterEach, describe, expect, it, vi } from 'vitest';

const completeSalesOrder = vi.fn();
vi.mock('@/lib/shop/checkout', async (original) => ({
  ...(await original<object>()),
  completeSalesOrder: (...args: unknown[]) => completeSalesOrder(...args),
}));
let settings: Record<string, unknown> = { mode: 'test', paypalLive: { clientId: '', secret: '' } };
vi.mock('@/lib/settings/settings', () => ({ loadSettings: async () => settings }));
// The guard's audit log: the capture checks the guard created and bound the order.
const audit = { boundOrderCustomer: vi.fn() };
vi.mock('@/lib/guard/runtime', () => ({ auditLog: () => audit }));

const { GET } = await import('./route');

const back = (token: string) => GET(new NextRequest(`https://shop.example/api/sales/paypal-return?token=${token}&PayerID=P1`));

describe('GET /api/sales/paypal-return', () => {
  afterEach(() => {
    completeSalesOrder.mockReset();
    vi.restoreAllMocks();
  });

  it('captures the order the buyer approved and shows the confirmation on /checkout', async () => {
    completeSalesOrder.mockResolvedValue({ orderId: '5O190127TN364715T', captureId: 'CAP-9', customerEmail: 'ana@example.com', amount: '99.98 USD' });

    const res = await back('5O190127TN364715T');

    expect(completeSalesOrder).toHaveBeenCalledWith('5O190127TN364715T', audit, { environment: 'sandbox' });
    expect(res.status).toBe(303);
    expect(res.headers.get('location')).toBe('https://shop.example/checkout?paid=ok&order=5O190127TN364715T&amount=99.98+USD');
  });

  it('goes to /checkout with a failure notice when the order could not be captured, details in the server log', async () => {
    completeSalesOrder.mockRejectedValue(new Error('Order X is CREATED, not approved by the buyer'));
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    const res = await back('X');

    expect(res.status).toBe(303);
    expect(res.headers.get('location')).toBe('https://shop.example/checkout?paid=failed');
    expect(log).toHaveBeenCalledWith('Sales order could not be captured', expect.any(Error));
  });
});

describe('GET /api/sales/paypal-return in live mode', () => {
  const ORDER = '5O190127TN364715T';
  afterEach(() => {
    completeSalesOrder.mockReset();
    audit.boundOrderCustomer.mockReset();
    settings = { mode: 'test', paypalLive: { clientId: '', secret: '' } };
    vi.unstubAllEnvs();
  });

  it('captures on live PayPal an order the guard created live, while live mode is on', async () => {
    vi.stubEnv('ALLOW_LIVE_MODE', 'true');
    settings = { mode: 'live', paypalLive: { clientId: 'live-id', secret: 'live-secret' } };
    audit.boundOrderCustomer.mockImplementation(async (_id: string, env?: string) => (env === 'live' ? 'ana@example.com' : undefined));
    completeSalesOrder.mockResolvedValue({ orderId: ORDER, captureId: 'CAP-9', customerEmail: 'ana@example.com', amount: '99.98 USD' });
    await back(ORDER);
    expect(completeSalesOrder).toHaveBeenCalledWith(ORDER, audit, { environment: 'live' });
  });

  it('stays on the sandbox when live mode is off, so a live order is never captured', async () => {
    settings = { mode: 'live', paypalLive: { clientId: 'live-id', secret: 'live-secret' } };
    audit.boundOrderCustomer.mockResolvedValue('ana@example.com');
    completeSalesOrder.mockRejectedValue(new Error('not an order the payment guard created'));
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const res = await back(ORDER);
    expect(completeSalesOrder).toHaveBeenCalledWith(ORDER, audit, { environment: 'sandbox' });
    expect(res.headers.get('location')).toContain('paid=failed');
  });
});
