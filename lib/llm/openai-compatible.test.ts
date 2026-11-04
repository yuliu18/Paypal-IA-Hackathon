import { afterEach, describe, expect, it, vi } from 'vitest';
import { requestCompletion } from './openai-compatible';

const config = { baseUrl: 'https://llm.test/v1/', apiKey: 'sk-test', model: 'model-a', timeoutMs: 1000 };
const answer = (content: string) => new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status: 200 });

function provider(...responses: Response[]) {
  const fetchMock = vi.fn(async () => responses.shift()!);
  vi.stubGlobal('fetch', fetchMock);
  return { bodies: () => fetchMock.mock.calls.map((call) => JSON.parse(((call as unknown[])[1] as RequestInit).body as string)) };
}

describe('requestCompletion', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('asks for temperature 0, so answers are as steady as the model allows', async () => {
    const { bodies } = provider(answer('ok'));

    expect(await requestCompletion(config, { messages: [{ role: 'user', content: 'hi' }] })).toEqual({ content: 'ok' });
    expect(bodies()).toEqual([{ model: 'model-a', temperature: 0, messages: [{ role: 'user', content: 'hi' }] }]);
  });

  it("asks once more without a temperature when the model only accepts its own", async () => {
    const refusal = '{"error":{"type":"invalid_request_error","message":"Upstream request failed: [invalid_request_error] invalid temperature: only 1 is allowed for this model"}}';
    const { bodies } = provider(new Response(refusal, { status: 400 }), answer('ok'));

    expect(await requestCompletion(config, { messages: [] })).toEqual({ content: 'ok' });
    expect(bodies()).toEqual([
      { model: 'model-a', temperature: 0, messages: [] },
      { model: 'model-a', messages: [] },
    ]);
  });

  it('does not ask again for any other refusal', async () => {
    const { bodies } = provider(new Response('{"error":"bad key"}', { status: 401 }));

    await expect(requestCompletion(config, { messages: [] })).rejects.toThrow('LLM 401: {"error":"bad key"}');
    expect(bodies()).toHaveLength(1);
  });

  it('fails with the second refusal when the model still refuses', async () => {
    provider(new Response('invalid temperature', { status: 400 }), new Response('invalid temperature again', { status: 400 }));

    await expect(requestCompletion(config, { messages: [] })).rejects.toThrow('LLM 400: invalid temperature again');
  });
});
