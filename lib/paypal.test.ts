import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { accessToken, chargeCard, getCapture, listInvoices, payPalApi } from './paypal';
import { saveSettings, setPaymentMode } from './settings/settings';

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

describe('the PayPal environment', () => {
  let dir: string;
  let file: string;
  const env = { SETTINGS_SECRET: 'a-long-settings-secret-for-tests' };
  const form = {
    name: 'Shop', contactEmails: '', refundPolicy: 'Refund damaged orders of the ticket customer.', currency: 'USD',
    autoRefundUpTo: '100', approvalUpTo: '250', dailyCap: '200', provider: 'custom', baseUrl: 'https://llm.example/v1',
    agentModel: 'm', judgeModel: '', apiKey: '', paypalClientId: 'sandbox-id', paypalSecret: 'sandbox-secret',
    paypalLiveClientId: 'live-id', paypalLiveSecret: 'live-secret',
  };
  type Seen = { url: string; basic?: string; bearer?: string };
  let seen: Seen[];

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'paypal-env-'));
    file = join(dir, 'settings.json');
    for (const [name, value] of Object.entries({ ...env, SETTINGS_FILE: file })) vi.stubEnv(name, value);
    await saveSettings(form, { file, env });
    seen = [];
    vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
      const auth = new Headers(init.headers).get('authorization') ?? '';
      if (auth.startsWith('Basic ')) {
        const basic = Buffer.from(auth.slice('Basic '.length), 'base64').toString();
        seen.push({ url, basic });
        return Response.json({ access_token: `token-for-${basic.split(':')[0]}`, expires_in: 3600 });
      }
      seen.push({ url, bearer: auth.slice('Bearer '.length) });
      return Response.json({ id: 'CAP-1', status: 'COMPLETED', amount: { value: '1.00', currency_code: 'USD' } });
    });
  });
  afterEach(async () => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    await rm(dir, { recursive: true, force: true });
  });

  it('names the live API only for exactly "live"', () => {
    expect(payPalApi('sandbox')).toBe('https://api-m.sandbox.paypal.com');
    expect(payPalApi('live')).toBe('https://api-m.paypal.com');
    expect(payPalApi('LIVE' as never)).toBe('https://api-m.sandbox.paypal.com');
    expect(payPalApi(undefined as never)).toBe('https://api-m.sandbox.paypal.com');
  });

  it('runs on the sandbox app and URL by default, even in live mode', async () => {
    vi.stubEnv('ALLOW_LIVE_MODE', 'true');
    await setPaymentMode('live', { file, env });
    await getCapture('CAP-1');
    expect(seen).toEqual([
      { url: 'https://api-m.sandbox.paypal.com/v1/oauth2/token', basic: 'sandbox-id:sandbox-secret' },
      { url: 'https://api-m.sandbox.paypal.com/v2/payments/captures/CAP-1', bearer: 'token-for-sandbox-id' },
    ]);
  });

  it('runs on the live app and URL only when asked for live and live mode is on', async () => {
    vi.stubEnv('ALLOW_LIVE_MODE', 'true');
    await setPaymentMode('live', { file, env });
    await getCapture('CAP-1', 'live');
    await getCapture('CAP-2', 'sandbox');
    // The sandbox token may still be cached from an earlier test; the live one never is reused for the sandbox.
    expect(seen.filter((s) => s.basic !== 'sandbox-id:sandbox-secret')).toEqual([
      { url: 'https://api-m.paypal.com/v1/oauth2/token', basic: 'live-id:live-secret' },
      { url: 'https://api-m.paypal.com/v2/payments/captures/CAP-1', bearer: 'token-for-live-id' },
      { url: 'https://api-m.sandbox.paypal.com/v2/payments/captures/CAP-2', bearer: 'token-for-sandbox-id' },
    ]);
    expect(seen.every((s) => s.url.startsWith('https://api-m.sandbox.paypal.com') === (s.basic ?? s.bearer ?? '').includes('sandbox-id'))).toBe(true);
  });

  it.each([
    ['the server does not allow it', undefined, 'live'],
    ['the owner left test mode on', 'true', 'test'],
  ] as const)('refuses a live token, calling nothing, when %s', async (_why, allow, mode) => {
    if (allow) vi.stubEnv('ALLOW_LIVE_MODE', allow);
    await setPaymentMode(mode, { file, env });
    await expect(accessToken('live')).rejects.toThrow('Live mode is off');
    expect(seen).toEqual([]);
  });

  it('refuses a live token, calling nothing, when the live app is gone', async () => {
    vi.stubEnv('ALLOW_LIVE_MODE', 'true');
    await setPaymentMode('live', { file, env });
    await saveSettings({ ...form, paypalLiveSecret: '', clearPaypalLiveSecret: true }, { file, env });
    await setPaymentMode('live', { file, env });
    await expect(accessToken('live')).rejects.toThrow('Live mode is off');
    expect(seen).toEqual([]);
  });
});

describe('listInvoices', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  const summary = (id: string) => ({ id, status: 'SENT', detail: { invoice_number: id, currency_code: 'USD' }, amount: { value: '10.00', currency_code: 'USD' } });

  it('keeps the list entry of an invoice whose detail PayPal fails to send, so one bad invoice does not sink the dashboard', async () => {
    vi.stubEnv('PAYPAL_CLIENT_ID', 'id');
    vi.stubEnv('PAYPAL_SECRET', 'secret');
    vi.stubGlobal('fetch', async (url: string) => {
      if (url.endsWith('/v1/oauth2/token')) return Response.json({ access_token: 't', expires_in: 3600 });
      if (url.includes('/v2/invoicing/invoices?')) return Response.json({ items: [summary('INV-1'), summary('INV-2')], total_pages: 1 });
      if (url.endsWith('/INV-1')) return Response.json({ ...summary('INV-1'), items: [{ name: 'Mug', quantity: '1', unit_amount: { value: '10.00', currency_code: 'USD' } }] });
      return new Response('not found', { status: 404 });
    });

    const invoices = await listInvoices();

    expect(invoices.map((i) => i.id)).toEqual(['INV-1', 'INV-2']);
    expect(invoices[0].items).toHaveLength(1);
    expect(invoices[1]).toEqual(summary('INV-2'));
  });

  it('still fails when the list itself cannot be read', async () => {
    vi.stubEnv('PAYPAL_CLIENT_ID', 'id');
    vi.stubEnv('PAYPAL_SECRET', 'secret');
    vi.stubGlobal('fetch', async (url: string) =>
      url.endsWith('/v1/oauth2/token') ? Response.json({ access_token: 't', expires_in: 3600 }) : new Response('forbidden', { status: 403 }),
    );

    await expect(listInvoices()).rejects.toThrow('PayPal 403');
  });
});
