import { afterEach, describe, expect, it, vi } from 'vitest';

const handleTicket = vi.fn();
vi.mock('@/lib/agent/handle-ticket', () => ({ handleTicket: (...args: unknown[]) => handleTicket(...args) }));
// The shop's mode for the live-mode cases; test mode with no live app unless a case says otherwise.
let settings: Record<string, unknown> = { mode: 'test', paypalLive: { clientId: '', secret: '' } };
vi.mock('@/lib/settings/settings', () => ({ loadSettings: async () => settings }));

const { POST } = await import('./route');

const post = (body: unknown, client = '10.0.0.1') =>
  POST(new Request('http://test/api/support/tickets', { method: 'POST', body: JSON.stringify(body), headers: { 'x-forwarded-for': client } }));

const ticket = { customerEmail: 'ana@example.com', message: 'Broken mug.' };

describe('POST /api/support/tickets', () => {
  afterEach(() => {
    handleTicket.mockReset();
    vi.restoreAllMocks();
  });

  it('hides internal error details from the caller and logs them on the server', async () => {
    handleTicket.mockRejectedValue(new Error('LLM 401: {"error":"invalid key sk-abc"}'));
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    const res = await post({ customerEmail: 'ana@example.com', message: 'Broken mug.' });

    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ error: { message: 'The support agent failed. Details are in the server log.' } });
    expect(log).toHaveBeenCalledWith('Support agent failed', expect.objectContaining({ message: expect.stringContaining('LLM 401') }));
    log.mockRestore();
  });

  it('still returns the agent result for a valid ticket', async () => {
    handleTicket.mockResolvedValue({ reply: 'Done', steps: [] });

    const res = await post({ customerEmail: 'ana@example.com', message: 'Broken mug.', agent: 'vulnerable' });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ reply: 'Done', steps: [] });
    expect(handleTicket).toHaveBeenCalledWith({ customerEmail: 'ana@example.com', message: 'Broken mug.' }, 'vulnerable', { environment: 'sandbox' });
  });

  it('still rejects an invalid email with its validation message', async () => {
    const res = await post({ customerEmail: 'nope', message: 'Broken mug.' });

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: { message: 'customerEmail must be an email address.' } });
  });

  it('turns away an address after 20 tickets with 429 and Retry-After, without running the agent', async () => {
    handleTicket.mockResolvedValue({ reply: 'Done', steps: [] });
    for (let i = 0; i < 20; i++) expect((await post(ticket, '10.0.0.20')).status).toBe(200);

    const res = await post(ticket, '10.0.0.20');

    expect(res.status).toBe(429);
    expect(Number(res.headers.get('retry-after'))).toBeGreaterThan(0);
    expect((await res.json()).error.message).toMatch(/^Too many tickets from this address\. Try again in \d+ seconds\.$/);
    expect(handleTicket).toHaveBeenCalledTimes(20);
    expect((await post(ticket, '10.0.0.21')).status).toBe(200);
  });

  it('turns away a third ticket from one address while two are still running', async () => {
    const finish: (() => void)[] = [];
    handleTicket.mockImplementation(() => new Promise((resolve) => finish.push(() => resolve({ reply: 'Done', steps: [] }))));
    const running = [post(ticket, '10.0.0.30'), post(ticket, '10.0.0.30')];
    await vi.waitFor(() => expect(finish).toHaveLength(2));

    const res = await post(ticket, '10.0.0.30');

    expect(res.status).toBe(429);
    expect(await res.json()).toEqual({ error: { message: 'The support agent is busy with other tickets. Try again in a few seconds.' } });
    finish.forEach((done) => done());
    await Promise.all(running);
  });

  // Two tickets may run at once per address: a third failure in a row is only a 502, not a 429,
  // if each failed ticket gave its slot back.
  it('frees the slot when the agent fails, so failures do not lock a client out', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    handleTicket.mockRejectedValue(new Error('down'));
    for (let i = 0; i < 3; i++) expect((await post(ticket, '10.0.0.40')).status).toBe(502);
  });

  it('does not count invalid tickets against the quota', async () => {
    for (let i = 0; i < 25; i++) expect((await post({ customerEmail: 'nope', message: 'x' }, '10.0.0.50')).status).toBe(400);
    handleTicket.mockResolvedValue({ reply: 'Done', steps: [] });
    expect((await post(ticket, '10.0.0.50')).status).toBe(200);
  });

  it('refuses a JSON body that is not an object', async () => {
    const res = await post(null);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: { message: 'Request body must be a JSON object.' } });
  });
});

describe('the PayPal environment of api/support/tickets', () => {
  const LIVE = { mode: 'live', paypalLive: { clientId: 'live-id', secret: 'live-secret' } };
  const send = (agent: string, headers: Record<string, string> = {}, client = '10.9.0.1') =>
    POST(new Request('http://test/api/support/tickets', { method: 'POST', body: JSON.stringify({ ...{ customerEmail: 'ana@example.com', message: 'Broken mug.' }, agent }), headers: { 'x-forwarded-for': client, ...headers } }));
  const apiKey = { 'x-pg-auth': 'api-key:key-1' };

  afterEach(() => {
    handleTicket.mockReset();
    settings = { mode: 'test', paypalLive: { clientId: '', secret: '' } };
    vi.unstubAllEnvs();
  });

  it('runs an API-key request on live PayPal when live mode is really on', async () => {
    vi.stubEnv('ALLOW_LIVE_MODE', 'true');
    settings = LIVE;
    handleTicket.mockResolvedValue({ reply: 'Done', steps: [] });
    expect((await send('careful', apiKey, '10.9.0.2')).status).toBe(200);
    expect(handleTicket.mock.calls[0]).toEqual([{ customerEmail: 'ana@example.com', message: 'Broken mug.' }, 'careful', { environment: 'live' }]);
  });

  it('keeps the owner\'s own requests (the test pages) on the sandbox in live mode', async () => {
    vi.stubEnv('ALLOW_LIVE_MODE', 'true');
    settings = LIVE;
    handleTicket.mockResolvedValue({ reply: 'Done', steps: [] });
    await send('careful', {}, '10.9.0.3');
    expect(handleTicket.mock.calls[0][2]).toMatchObject({ environment: 'sandbox' });
  });

  it.each([
    ['the server does not allow live mode', undefined, LIVE],
    ['the live app is missing', 'true', { mode: 'live', paypalLive: { clientId: 'live-id', secret: '' } }],
    ['the owner left test mode on', 'true', { ...LIVE, mode: 'test' }],
  ])('fails closed to the sandbox for an API-key request when %s', async (_why, allow, saved) => {
    if (allow) vi.stubEnv('ALLOW_LIVE_MODE', allow);
    settings = saved;
    handleTicket.mockResolvedValue({ reply: 'Done', steps: [] });
    await send('careful', apiKey, '10.9.0.4');
    expect(handleTicket.mock.calls[0][2]).toMatchObject({ environment: 'sandbox' });
  });

  it('never runs the vulnerable agent with real money', async () => {
    vi.stubEnv('ALLOW_LIVE_MODE', 'true');
    settings = LIVE;
    const res = await send('vulnerable', apiKey, '10.9.0.5');
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: { message: 'agent "vulnerable" runs only on the PayPal sandbox, never in live mode.' } });
    expect(handleTicket).not.toHaveBeenCalled();
  });
});
