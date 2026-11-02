import { shopOrigin } from '@/lib/shop/checkout';
import { afterEach, describe, expect, it, vi } from 'vitest';

const handleSalesChat = vi.fn();
vi.mock('@/lib/agent/handle-sales-chat', () => ({ handleSalesChat: (...args: unknown[]) => handleSalesChat(...args) }));
// The shop's mode for the live-mode cases; test mode with no live app unless a case says otherwise.
let settings: Record<string, unknown> = { mode: 'test', paypalLive: { clientId: '', secret: '' } };
vi.mock('@/lib/settings/settings', () => ({ loadSettings: async () => settings }));

const { POST } = await import('./route');

const post = (body: unknown, client = '10.0.0.1', origin = 'https://shop.example') =>
  POST(
    new Request('http://test/api/sales/chats', { method: 'POST', body: JSON.stringify(body), headers: { 'x-forwarded-for': client, origin } }),
  );

const chat = { customerEmail: 'ana@example.com', message: 'Two ceramic mug sets, please.' };

describe('POST /api/sales/chats', () => {
  afterEach(() => {
    handleSalesChat.mockReset();
    vi.restoreAllMocks();
  });

  it('runs the sales agent for the customer who writes, with the configured shop origin, not the one the request claims', async () => {
    handleSalesChat.mockResolvedValue({ reply: 'Pay here', steps: [] });

    const res = await post({ ...chat, agent: 'vulnerable' });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ reply: 'Pay here', steps: [], environment: 'sandbox' });
    expect(handleSalesChat).toHaveBeenCalledWith(chat, 'vulnerable', { shopOrigin: shopOrigin(), environment: 'sandbox' });
    expect(shopOrigin()).not.toBe('https://shop.example');
  });

  it('hides internal error details from the caller and logs them on the server', async () => {
    handleSalesChat.mockRejectedValue(new Error('LLM 401: invalid key sk-abc'));
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    const res = await post(chat);

    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ error: { message: 'The sales agent failed. Details are in the server log.' } });
    expect(log).toHaveBeenCalledWith('Sales agent failed', expect.objectContaining({ message: expect.stringContaining('LLM 401') }));
  });

  it('rejects an invalid email, an empty or long message, an unknown agent mode and a body that is not an object', async () => {
    const cases: [unknown, string][] = [
      [{ customerEmail: 'nope', message: 'x' }, 'customerEmail must be an email address.'],
      [{ customerEmail: 'ana@example.com', message: '  ' }, 'message must be a non-empty string.'],
      [{ customerEmail: 'ana@example.com', message: 'x'.repeat(4_001) }, 'message must be at most 4000 characters.'],
      [{ ...chat, agent: 'rogue' }, 'agent must be "careful" or "vulnerable".'],
      [null, 'Request body must be a JSON object.'],
    ];
    for (const [body, message] of cases) {
      const res = await post(body);
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: { message } });
    }
    expect(handleSalesChat).not.toHaveBeenCalled();
  });

  it('turns away an address after 20 chats with 429 and Retry-After, without running the agent', async () => {
    handleSalesChat.mockResolvedValue({ reply: 'Done', steps: [] });
    for (let i = 0; i < 20; i++) expect((await post(chat, '10.0.0.20')).status).toBe(200);

    const res = await post(chat, '10.0.0.20');

    expect(res.status).toBe(429);
    expect(Number(res.headers.get('retry-after'))).toBeGreaterThan(0);
    expect((await res.json()).error.message).toMatch(/^Too many sales chats from this address\. Try again in \d+ seconds\.$/);
    expect(handleSalesChat).toHaveBeenCalledTimes(20);
  });
});

describe('the PayPal environment of api/sales/chats', () => {
  const LIVE = { mode: 'live', paypalLive: { clientId: 'live-id', secret: 'live-secret' } };
  const send = (agent: string, headers: Record<string, string> = {}, client = '10.9.0.1') =>
    POST(new Request('http://test/api/sales/chats', { method: 'POST', body: JSON.stringify({ ...{ customerEmail: 'ana@example.com', message: 'Two mug sets.' }, agent }), headers: { 'x-forwarded-for': client, ...headers } }));
  const apiKey = { 'x-pg-auth': 'api-key:key-1' };

  afterEach(() => {
    handleSalesChat.mockReset();
    settings = { mode: 'test', paypalLive: { clientId: '', secret: '' } };
    vi.unstubAllEnvs();
  });

  it('runs an API-key request on live PayPal when live mode is really on', async () => {
    vi.stubEnv('ALLOW_LIVE_MODE', 'true');
    settings = LIVE;
    handleSalesChat.mockResolvedValue({ reply: 'Done', steps: [] });
    const res = await send('careful', apiKey, '10.9.0.2');
    expect(res.status).toBe(200);
    expect((await res.json()).environment).toBe('live');
    expect(handleSalesChat.mock.calls[0]).toEqual([{ customerEmail: 'ana@example.com', message: 'Two mug sets.' }, 'careful', { shopOrigin: shopOrigin(), environment: 'live' }]);
  });

  it('keeps the owner\'s own requests (the test pages) on the sandbox in live mode', async () => {
    vi.stubEnv('ALLOW_LIVE_MODE', 'true');
    settings = LIVE;
    handleSalesChat.mockResolvedValue({ reply: 'Done', steps: [] });
    await send('careful', {}, '10.9.0.3');
    expect(handleSalesChat.mock.calls[0][2]).toMatchObject({ environment: 'sandbox' });
  });

  it.each([
    ['the server does not allow live mode', undefined, LIVE],
    ['the live app is missing', 'true', { mode: 'live', paypalLive: { clientId: 'live-id', secret: '' } }],
    ['the owner left test mode on', 'true', { ...LIVE, mode: 'test' }],
  ])('fails closed to the sandbox for an API-key request when %s', async (_why, allow, saved) => {
    if (allow) vi.stubEnv('ALLOW_LIVE_MODE', allow);
    settings = saved;
    handleSalesChat.mockResolvedValue({ reply: 'Done', steps: [] });
    await send('careful', apiKey, '10.9.0.4');
    expect(handleSalesChat.mock.calls[0][2]).toMatchObject({ environment: 'sandbox' });
  });

  it('never runs the vulnerable agent with real money', async () => {
    vi.stubEnv('ALLOW_LIVE_MODE', 'true');
    settings = LIVE;
    const res = await send('vulnerable', apiKey, '10.9.0.5');
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: { message: 'agent "vulnerable" runs only on the PayPal sandbox, never in live mode.' } });
    expect(handleSalesChat).not.toHaveBeenCalled();
  });
});
