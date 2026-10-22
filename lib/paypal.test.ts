import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { accessToken, chargeCard } from './paypal';
import { saveSettings } from './settings/settings';

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

describe('accessToken', () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'paypal-settings-'));
  });
  afterEach(async () => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    await rm(dir, { recursive: true, force: true });
  });

  it('uses the credentials saved on the settings page and gets a new token when they change', async () => {
    const file = join(dir, 'settings.json');
    const env = { PAYPAL_CLIENT_ID: 'env-id', PAYPAL_SECRET: 'env-secret', SETTINGS_SECRET: 'a-long-settings-secret-for-tests' };
    for (const [name, value] of Object.entries({ ...env, SETTINGS_FILE: file })) vi.stubEnv(name, value);
    const basics: string[] = [];
    vi.stubGlobal('fetch', async (_url: string, init: RequestInit) => {
      basics.push(Buffer.from(new Headers(init.headers).get('authorization')!.slice('Basic '.length), 'base64').toString());
      return Response.json({ access_token: `t${basics.length}`, expires_in: 3600 });
    });
    const form = {
      name: 'Shop', contactEmails: '', refundPolicy: 'Refund damaged orders of the ticket customer.', currency: 'USD',
      autoRefundUpTo: '100', approvalUpTo: '250', dailyCap: '200', provider: 'custom', baseUrl: 'https://llm.example/v1',
      agentModel: 'm', judgeModel: '', apiKey: '',
    };

    await saveSettings({ ...form, paypalClientId: 'shop-id', paypalSecret: 'shop-secret' }, { file, env });
    expect(await accessToken()).toBe('t1');
    expect(await accessToken()).toBe('t1');
    await saveSettings({ ...form, paypalClientId: 'other-id', paypalSecret: 'other-secret' }, { file, env });
    expect(await accessToken()).toBe('t2');
    expect(basics).toEqual(['shop-id:shop-secret', 'other-id:other-secret']);
  });
});
