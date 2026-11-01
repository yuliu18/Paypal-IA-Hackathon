import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPayPalDisputeLookup } from './paypal-dispute-lookup';
import { payPalAdapters } from './paypal-environment';
import { createPayPalInvoiceLookup } from './paypal-invoice-lookup';
import { createPayPalOrderBinder } from './paypal-order-binder';
import { createPayPalSubscriptionLookup } from './paypal-subscription-lookup';

let dir: string;
let urls: string[];
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'paypal-adapters-'));
  // No live app, test mode: a live token must be refused.
  vi.stubEnv('SETTINGS_FILE', join(dir, 'settings.json'));
  vi.stubEnv('PAYPAL_CLIENT_ID', 'sandbox-id');
  vi.stubEnv('PAYPAL_SECRET', 'sandbox-secret');
  vi.stubEnv('ALLOW_LIVE_MODE', 'true');
  urls = [];
  vi.stubGlobal('fetch', async (url: string) => {
    urls.push(url);
    return url.endsWith('/v1/oauth2/token') ? Response.json({ access_token: 't', expires_in: 3600 }) : Response.json({}, { status: 404 });
  });
});
afterEach(async () => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  await rm(dir, { recursive: true, force: true });
});

const ORDER = '5O190127TN364715T';
const fakeFetch = () => {
  const seen: string[] = [];
  const fetch = (async (url: string) => {
    seen.push(url);
    return new Response(null, { status: 404 });
  }) as typeof globalThis.fetch;
  return { seen, fetch };
};

describe('the guard adapters', () => {
  it.each([
    ['sandbox', 'https://api-m.sandbox.paypal.com'],
    ['live', 'https://api-m.paypal.com'],
  ] as const)('call the %s API they were built for', async (environment, base) => {
    const { seen, fetch } = fakeFetch();
    const token = async () => 't';
    await createPayPalDisputeLookup({ environment, fetch, token }).getDispute('PP-D-1');
    await createPayPalInvoiceLookup({ environment, fetch, token }).getInvoice('INV2-1');
    await createPayPalSubscriptionLookup({ environment, fetch, token }).getSubscription('I-1');
    await createPayPalOrderBinder({ environment, fetch, token }).bindToCustomer(ORDER, 'ana@example.com').catch(() => undefined);
    expect(seen).toHaveLength(4);
    for (const url of seen) expect(url.startsWith(`${base}/`)).toBe(true);
  });

  it('default to the sandbox', async () => {
    const { seen, fetch } = fakeFetch();
    await createPayPalDisputeLookup({ fetch, token: async () => 't' }).getDispute('PP-D-1');
    expect(seen[0]).toBe('https://api-m.sandbox.paypal.com/v1/customer/disputes/PP-D-1');
  });

  it('built for the sandbox, use the sandbox app and URL only', async () => {
    const sandbox = payPalAdapters('sandbox');
    await sandbox.disputes.getDispute('PP-D-1');
    await sandbox.captures.getCapture('CAP-1').catch(() => undefined);
    expect(urls.length).toBeGreaterThan(0);
    for (const url of urls) expect(url.startsWith('https://api-m.sandbox.paypal.com/')).toBe(true);
  });

  it('built for live while live mode is off, refuse before reaching PayPal', async () => {
    const live = payPalAdapters('live');
    await expect(live.disputes.getDispute('PP-D-1')).rejects.toThrow('Live mode is off');
    await expect(live.captures.getCapture('CAP-1')).rejects.toThrow('Live mode is off');
    await expect(live.invoices.getInvoice('INV2-1')).rejects.toThrow('Live mode is off');
    await expect(live.subscriptions.getSubscription('I-1')).rejects.toThrow('Live mode is off');
    await expect(live.binder.bindToCustomer(ORDER, 'ana@example.com')).rejects.toThrow('Live mode is off');
    expect(urls).toEqual([]);
  });
});
