import { shopOrigin } from '@/lib/shop/checkout';
import { afterEach, describe, expect, it, vi } from 'vitest';

const handleSalesChat = vi.fn();
vi.mock('@/lib/agent/handle-sales-chat', () => ({ handleSalesChat: (...args: unknown[]) => handleSalesChat(...args) }));

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
    expect(await res.json()).toEqual({ reply: 'Pay here', steps: [] });
    expect(handleSalesChat).toHaveBeenCalledWith(chat, 'vulnerable', { shopOrigin: shopOrigin() });
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
