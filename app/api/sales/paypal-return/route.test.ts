import { NextRequest } from 'next/server';
import { afterEach, describe, expect, it, vi } from 'vitest';

const completeSalesOrder = vi.fn();
vi.mock('@/lib/shop/checkout', () => ({ completeSalesOrder: (...args: unknown[]) => completeSalesOrder(...args) }));
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

  it('captures the order the buyer approved and shows the confirmation on /sales', async () => {
    completeSalesOrder.mockResolvedValue({ orderId: '5O190127TN364715T', captureId: 'CAP-9', customerEmail: 'ana@example.com', amount: '99.98 USD' });

    const res = await back('5O190127TN364715T');

    expect(completeSalesOrder).toHaveBeenCalledWith('5O190127TN364715T', audit);
    expect(res.status).toBe(303);
    expect(res.headers.get('location')).toBe('https://shop.example/sales?paid=ok&order=5O190127TN364715T&amount=99.98+USD');
  });

  it('goes back to /sales with a failure notice when the order could not be captured, details in the server log', async () => {
    completeSalesOrder.mockRejectedValue(new Error('Order X is CREATED, not approved by the buyer'));
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    const res = await back('X');

    expect(res.status).toBe(303);
    expect(res.headers.get('location')).toBe('https://shop.example/sales?paid=failed');
    expect(log).toHaveBeenCalledWith('Sales order could not be captured', expect.any(Error));
  });
});
