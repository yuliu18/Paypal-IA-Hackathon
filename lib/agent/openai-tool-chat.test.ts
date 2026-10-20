import { afterEach, describe, expect, it, vi } from 'vitest';
import { openAiCompatibleToolChat } from './openai-tool-chat';

const tools = [{ name: 'get_order', description: 'Get an order', parameters: { type: 'object', properties: { id: { type: 'string' } } } }];
const messages = [{ role: 'user' as const, content: 'Where is ORD-1?' }];

function stubFetch(response: () => Response) {
  const sent: { url: string; headers: Headers; body: Record<string, unknown> }[] = [];
  vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
    sent.push({ url, headers: new Headers(init.headers), body: JSON.parse(String(init.body)) });
    return response();
  });
  return sent;
}

describe('openAiCompatibleToolChat', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('sends the messages and the tools as OpenAI functions with key and extra headers', async () => {
    const sent = stubFetch(() => new Response(JSON.stringify({ choices: [{ message: { role: 'assistant', content: 'hi' } }] })));
    const chat = openAiCompatibleToolChat({ baseUrl: 'https://llm.test/v1/', apiKey: 'k', model: 'm', headers: { 'x-opencode-session': 's-1' } });

    await chat(messages, tools);

    expect(sent[0].url).toBe('https://llm.test/v1/chat/completions');
    expect(sent[0].headers.get('authorization')).toBe('Bearer k');
    expect(sent[0].headers.get('x-opencode-session')).toBe('s-1');
    expect(sent[0].body).toMatchObject({
      model: 'm',
      messages,
      tools: [{ type: 'function', function: { name: 'get_order', description: 'Get an order', parameters: tools[0].parameters } }],
    });
  });

  it('returns the assistant message with its tool calls', async () => {
    const toolCall = { id: 'c1', type: 'function', function: { name: 'get_order', arguments: '{"id":"ORD-1"}' } };
    stubFetch(() => new Response(JSON.stringify({ choices: [{ message: { role: 'assistant', content: null, tool_calls: [toolCall] } }] })));
    const chat = openAiCompatibleToolChat({ baseUrl: 'https://llm.test/v1', apiKey: 'k', model: 'm' });

    expect(await chat(messages, tools)).toEqual({ role: 'assistant', content: null, tool_calls: [toolCall] });
  });

  it('throws with the provider status when the call fails', async () => {
    stubFetch(() => new Response('bad request', { status: 400 }));
    const chat = openAiCompatibleToolChat({ baseUrl: 'https://llm.test/v1', apiKey: 'k', model: 'm' });

    await expect(chat(messages, tools)).rejects.toThrow('LLM 400: bad request');
  });

  it('throws when the provider returns no message', async () => {
    stubFetch(() => new Response(JSON.stringify({ choices: [] })));
    const chat = openAiCompatibleToolChat({ baseUrl: 'https://llm.test/v1', apiKey: 'k', model: 'm' });

    await expect(chat(messages, tools)).rejects.toThrow('empty completion');
  });

  it('aborts a provider that does not answer within the timeout', async () => {
    vi.stubGlobal('fetch', (_url: string, init: RequestInit) =>
      new Promise((_resolve, reject) => init.signal?.addEventListener('abort', () => reject(init.signal?.reason))),
    );
    const chat = openAiCompatibleToolChat({ baseUrl: 'https://llm.test/v1', apiKey: 'k', model: 'm', timeoutMs: 20 });

    await expect(chat(messages, tools)).rejects.toThrow();
  });
});
