import { afterEach, describe, expect, it, vi } from 'vitest';

const handleTicket = vi.fn();
vi.mock('@/lib/agent/handle-ticket', () => ({ handleTicket: (...args: unknown[]) => handleTicket(...args) }));

const { POST } = await import('./route');

const post = (body: unknown) =>
  POST(new Request('http://test/api/support/tickets', { method: 'POST', body: JSON.stringify(body) }));

describe('POST /api/support/tickets', () => {
  afterEach(() => handleTicket.mockReset());

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
    expect(handleTicket).toHaveBeenCalledWith({ customerEmail: 'ana@example.com', message: 'Broken mug.' }, 'vulnerable');
  });

  it('still rejects an invalid email with its validation message', async () => {
    const res = await post({ customerEmail: 'nope', message: 'Broken mug.' });

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: { message: 'customerEmail must be an email address.' } });
  });
});
