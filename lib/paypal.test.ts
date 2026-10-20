import { afterEach, describe, expect, it, vi } from 'vitest';
import { chargeCard } from './paypal';

describe('chargeCard', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it('captures a card order tagged with the customer and returns its capture', async () => {
    vi.stubEnv('PAYPAL_CLIENT_ID', 'id');
    vi.stubEnv('PAYPAL_SECRET', 'secret');
    const requests: { url: string; init: RequestInit }[] = [];
    vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
      requests.push({ url, init });
      if (url.endsWith('/v1/oauth2/token')) return Response.json({ access_token: 't', expires_in: 3600 });
      return Response.json(
        {
          id: 'ORD-1',
          status: 'COMPLETED',
          purchase_units: [{ payments: { captures: [{ id: 'CAP-1', status: 'COMPLETED', amount: { value: '49.99', currency_code: 'USD' } }] } }],
        },
        { status: 201 },
      );
    });

    const capture = await chargeCard({ amount: { value: '49.99', currency_code: 'USD' }, customerEmail: 'ana@example.com', description: 'Mug set' });

    expect(capture).toEqual({ orderId: 'ORD-1', captureId: 'CAP-1', status: 'COMPLETED' });
    const order = requests.find((r) => r.url.endsWith('/v2/checkout/orders'))!;
    expect(new Headers(order.init.headers).get('paypal-request-id')).toBeTruthy();
    const body = JSON.parse(String(order.init.body));
    expect(body.intent).toBe('CAPTURE');
    expect(body.purchase_units[0]).toMatchObject({ custom_id: 'ana@example.com', description: 'Mug set', amount: { value: '49.99', currency_code: 'USD' } });
    expect(body.payment_source.card.number).toBe('4111111111111111');
  });

  it('fails when PayPal does not complete the capture', async () => {
    vi.stubEnv('PAYPAL_CLIENT_ID', 'id');
    vi.stubEnv('PAYPAL_SECRET', 'secret');
    vi.stubGlobal('fetch', async (url: string) =>
      url.endsWith('/v1/oauth2/token')
        ? Response.json({ access_token: 't', expires_in: 3600 })
        : Response.json({ id: 'ORD-2', status: 'PAYER_ACTION_REQUIRED', purchase_units: [] }, { status: 201 }),
    );

    await expect(chargeCard({ amount: { value: '1.00', currency_code: 'USD' }, customerEmail: 'ana@example.com', description: 'x' })).rejects.toThrow(
      'Order ORD-2 was not captured (PAYER_ACTION_REQUIRED)',
    );
  });
});
