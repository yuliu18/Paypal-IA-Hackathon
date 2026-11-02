import { afterEach, describe, expect, it, vi } from 'vitest';

const handleBillingTask = vi.fn();
vi.mock('@/lib/agent/handle-billing-task', () => ({ handleBillingTask: (...args: unknown[]) => handleBillingTask(...args) }));
// The shop's mode for the live-mode cases; test mode with no live app unless a case says otherwise.
let settings: Record<string, unknown> = { mode: 'test', paypalLive: { clientId: '', secret: '' } };
vi.mock('@/lib/settings/settings', () => ({ loadSettings: async () => settings }));

const { POST } = await import('./route');

const post = (body: unknown, client = '10.0.0.1') =>
  POST(new Request('http://test/api/billing/tasks', { method: 'POST', body: JSON.stringify(body), headers: { 'x-forwarded-for': client } }));

const task = { customerEmail: 'ana@example.com', message: 'Invoice two mug sets.' };

describe('POST /api/billing/tasks', () => {
  afterEach(() => {
    handleBillingTask.mockReset();
    vi.restoreAllMocks();
  });

  it('hides internal error details from the caller and logs them on the server', async () => {
    handleBillingTask.mockRejectedValue(new Error('LLM 401: {"error":"invalid key sk-abc"}'));
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    const res = await post({ customerEmail: 'ana@example.com', message: 'Invoice two mug sets.' });

    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ error: { message: 'The billing agent failed. Details are in the server log.' } });
    expect(log).toHaveBeenCalledWith('Billing agent failed', expect.objectContaining({ message: expect.stringContaining('LLM 401') }));
    log.mockRestore();
  });

  it('returns the agent result for a valid task', async () => {
    handleBillingTask.mockResolvedValue({ reply: 'Done', steps: [] });

    const res = await post({ customerEmail: 'ana@example.com', message: 'Invoice two mug sets.', agent: 'vulnerable' });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ reply: 'Done', steps: [], environment: 'sandbox' });
    expect(handleBillingTask).toHaveBeenCalledWith({ customerEmail: 'ana@example.com', message: 'Invoice two mug sets.' }, 'vulnerable', { environment: 'sandbox' });
  });

  it('rejects an invalid email with its validation message', async () => {
    const res = await post({ customerEmail: 'nope', message: 'Invoice two mug sets.' });

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: { message: 'customerEmail must be an email address.' } });
  });

  it('turns away an address after 20 tasks with 429 and Retry-After, without running the agent', async () => {
    handleBillingTask.mockResolvedValue({ reply: 'Done', steps: [] });
    for (let i = 0; i < 20; i++) expect((await post(task, '10.0.0.20')).status).toBe(200);

    const res = await post(task, '10.0.0.20');

    expect(res.status).toBe(429);
    expect(Number(res.headers.get('retry-after'))).toBeGreaterThan(0);
    expect((await res.json()).error.message).toMatch(/^Too many billing tasks from this address\. Try again in \d+ seconds\.$/);
    expect(handleBillingTask).toHaveBeenCalledTimes(20);
    expect((await post(task, '10.0.0.21')).status).toBe(200);
  });

  it('turns away a third task from one address while two are still running', async () => {
    const finish: (() => void)[] = [];
    handleBillingTask.mockImplementation(() => new Promise((resolve) => finish.push(() => resolve({ reply: 'Done', steps: [] }))));
    const running = [post(task, '10.0.0.30'), post(task, '10.0.0.30')];
    await vi.waitFor(() => expect(finish).toHaveLength(2));

    const res = await post(task, '10.0.0.30');

    expect(res.status).toBe(429);
    expect(await res.json()).toEqual({ error: { message: 'The billing agent is busy with other tasks. Try again in a few seconds.' } });
    finish.forEach((done) => done());
    await Promise.all(running);
  });

  // Two tasks may run at once per address: a third failure in a row is only a 502, not a 429,
  // if each failed task gave its slot back.
  it('frees the slot when the agent fails, so failures do not lock a client out', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    handleBillingTask.mockRejectedValue(new Error('down'));
    for (let i = 0; i < 3; i++) expect((await post(task, '10.0.0.40')).status).toBe(502);
  });

  it('does not count invalid tasks against the quota', async () => {
    for (let i = 0; i < 25; i++) expect((await post({ customerEmail: 'nope', message: 'x' }, '10.0.0.50')).status).toBe(400);
    handleBillingTask.mockResolvedValue({ reply: 'Done', steps: [] });
    expect((await post(task, '10.0.0.50')).status).toBe(200);
  });

  it('refuses a JSON body that is not an object', async () => {
    const res = await post(null);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: { message: 'Request body must be a JSON object.' } });
  });
  it('rejects a message over 4000 characters and an unknown agent mode', async () => {
    const long = await post({ customerEmail: 'ana@example.com', message: 'x'.repeat(4_001) });
    expect(long.status).toBe(400);
    expect(await long.json()).toEqual({ error: { message: 'message must be at most 4000 characters.' } });

    const mode = await post({ ...task, agent: 'rogue' });
    expect(mode.status).toBe(400);
    expect(await mode.json()).toEqual({ error: { message: 'agent must be "careful" or "vulnerable".' } });
    expect(handleBillingTask).not.toHaveBeenCalled();
  });
});

describe('the PayPal environment of api/billing/tasks', () => {
  const LIVE = { mode: 'live', paypalLive: { clientId: 'live-id', secret: 'live-secret' } };
  const send = (agent: string, headers: Record<string, string> = {}, client = '10.9.0.1') =>
    POST(new Request('http://test/api/billing/tasks', { method: 'POST', body: JSON.stringify({ ...{ customerEmail: 'ana@example.com', message: 'Invoice two mug sets.' }, agent }), headers: { 'x-forwarded-for': client, ...headers } }));
  const apiKey = { 'x-pg-auth': 'api-key:key-1' };

  afterEach(() => {
    handleBillingTask.mockReset();
    settings = { mode: 'test', paypalLive: { clientId: '', secret: '' } };
    vi.unstubAllEnvs();
  });

  it('runs an API-key request on live PayPal when live mode is really on', async () => {
    vi.stubEnv('ALLOW_LIVE_MODE', 'true');
    settings = LIVE;
    handleBillingTask.mockResolvedValue({ reply: 'Done', steps: [] });
    const res = await send('careful', apiKey, '10.9.0.2');
    expect(res.status).toBe(200);
    expect((await res.json()).environment).toBe('live');
    expect(handleBillingTask.mock.calls[0]).toEqual([{ customerEmail: 'ana@example.com', message: 'Invoice two mug sets.' }, 'careful', { environment: 'live' }]);
  });

  it('keeps the owner\'s own requests (the test pages) on the sandbox in live mode', async () => {
    vi.stubEnv('ALLOW_LIVE_MODE', 'true');
    settings = LIVE;
    handleBillingTask.mockResolvedValue({ reply: 'Done', steps: [] });
    await send('careful', {}, '10.9.0.3');
    expect(handleBillingTask.mock.calls[0][2]).toMatchObject({ environment: 'sandbox' });
  });

  it.each([
    ['the server does not allow live mode', undefined, LIVE],
    ['the live app is missing', 'true', { mode: 'live', paypalLive: { clientId: 'live-id', secret: '' } }],
    ['the owner left test mode on', 'true', { ...LIVE, mode: 'test' }],
  ])('fails closed to the sandbox for an API-key request when %s', async (_why, allow, saved) => {
    if (allow) vi.stubEnv('ALLOW_LIVE_MODE', allow);
    settings = saved;
    handleBillingTask.mockResolvedValue({ reply: 'Done', steps: [] });
    await send('careful', apiKey, '10.9.0.4');
    expect(handleBillingTask.mock.calls[0][2]).toMatchObject({ environment: 'sandbox' });
  });

  it('never runs the vulnerable agent with real money', async () => {
    vi.stubEnv('ALLOW_LIVE_MODE', 'true');
    settings = LIVE;
    const res = await send('vulnerable', apiKey, '10.9.0.5');
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: { message: 'agent "vulnerable" runs only on the PayPal sandbox, never in live mode.' } });
    expect(handleBillingTask).not.toHaveBeenCalled();
  });
});
