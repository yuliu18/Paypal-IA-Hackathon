import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { listModels, testPayPal } from './connection';
import { PROVIDERS, providerFor } from './providers';
import { saveSettings, testCredentials, type SettingsForm } from './settings';

describe('provider catalog', () => {
  it('covers Anthropic, Chinese and local providers, each with an http(s) base URL', () => {
    const ids = PROVIDERS.map((p) => p.id);
    expect(ids).toEqual(expect.arrayContaining(['anthropic', 'openai', 'deepseek', 'qwen', 'moonshot', 'zhipu', 'minimax', 'ollama', 'lmstudio', 'openrouter', 'groq']));
    expect(new Set(ids).size).toBe(ids.length);
    for (const provider of PROVIDERS) expect(provider.baseUrl).toMatch(/^https?:\/\/[^\s]+[^/]$/);
  });

  it('recognises a preset from its base URL, ignoring a trailing slash', () => {
    expect(providerFor('https://api.anthropic.com/v1/')).toBe('anthropic');
    expect(providerFor('http://localhost:11434/v1')).toBe('ollama');
    expect(providerFor('https://llm.example/v1')).toBe('custom');
  });
});

type Call = { url: string; headers: Headers; body?: string };
function fakeFetch(answer: (call: Call) => Response) {
  const calls: Call[] = [];
  const fetchImpl = (async (url: string, init: RequestInit = {}) => {
    const call = { url, headers: new Headers(init.headers), body: init.body ? String(init.body) : undefined };
    calls.push(call);
    return answer(call);
  }) as typeof fetch;
  return { calls, fetchImpl };
}

describe('listModels', () => {
  it("lists the provider's models, sorted, with the key as a bearer token", async () => {
    const { calls, fetchImpl } = fakeFetch(() => Response.json({ data: [{ id: 'b-model' }, { id: 'a-model' }] }));
    expect(await listModels({ baseUrl: 'https://api.deepseek.com/v1/', apiKey: 'sk-1' }, fetchImpl)).toEqual({ ok: true, models: ['a-model', 'b-model'] });
    expect(calls[0].url).toBe('https://api.deepseek.com/v1/models');
    expect(calls[0].headers.get('authorization')).toBe('Bearer sk-1');
  });

  it("also sends Anthropic's own key header", async () => {
    const { calls, fetchImpl } = fakeFetch(() => Response.json({ data: [{ id: 'claude-x' }] }));
    await listModels({ baseUrl: 'https://api.anthropic.com/v1', apiKey: 'sk-ant' }, fetchImpl);
    expect(calls[0].headers.get('x-api-key')).toBe('sk-ant');
    expect(calls[0].headers.get('anthropic-version')).toBeTruthy();
  });

  it('reports a refused key or an unreachable server without repeating the key', async () => {
    const refused = fakeFetch(() => new Response('invalid key sk-secret-123', { status: 401 }));
    expect(await listModels({ baseUrl: 'https://x.example/v1', apiKey: 'sk-secret-123' }, refused.fetchImpl)).toEqual({
      ok: false,
      error: 'The provider answered 401: invalid key ••••',
    });
    const down = fakeFetch(() => {
      throw new TypeError('fetch failed');
    });
    expect(await listModels({ baseUrl: 'http://localhost:11434/v1', apiKey: '' }, down.fetchImpl)).toEqual({
      ok: false,
      error: 'Could not reach http://localhost:11434/v1 (fetch failed)',
    });
  });
});

describe('listModels errors', () => {
  it('never repeats the key when fetch throws', async () => {
    const thrower = (async () => {
      throw new Error('Headers.append: "Bearer sk-saved-abcd1234" is an invalid header value.');
    }) as unknown as typeof fetch;
    const result = await listModels({ baseUrl: 'https://o.example/v1', apiKey: 'sk-saved-abcd1234' }, thrower);
    expect(JSON.stringify(result)).not.toContain('sk-saved-abcd1234');
  });
});

describe('listModels without a model list', () => {
  it("checks the key with a one-token chat when the provider has no /models, as OpenCode Go", async () => {
    const { calls, fetchImpl } = fakeFetch(({ url }) =>
      url.endsWith('/models') ? new Response('Not Found', { status: 404 }) : Response.json({ choices: [{ message: { content: 'ok' } }] }),
    );
    expect(await listModels({ baseUrl: 'https://opencode.ai/inference/go/openai/v1', apiKey: 'k', model: 'mini' }, fetchImpl)).toEqual({ ok: true, models: [] });
    expect(calls[1].url).toBe('https://opencode.ai/inference/go/openai/v1/chat/completions');
    expect(JSON.parse(calls[1].body!)).toMatchObject({ model: 'mini', max_tokens: 1 });
    expect(calls[1].headers.get('x-opencode-session')).toBeTruthy();
  });

  it('reports the chat error, or asks for a model when none is chosen', async () => {
    const { fetchImpl } = fakeFetch(({ url }) => (url.endsWith('/models') ? new Response('', { status: 404 }) : new Response('bad key sk-k1', { status: 401 })));
    expect(await listModels({ baseUrl: 'https://x.example/v1', apiKey: 'sk-k1', model: 'm' }, fetchImpl)).toEqual({ ok: false, error: 'The provider answered 401: bad key ••••' });
    expect(await listModels({ baseUrl: 'https://x.example/v1', apiKey: 'sk-k1', model: '' }, fetchImpl)).toEqual({
      ok: false,
      error: 'This provider does not list its models: type the agent model id, then test again.',
    });
  });
});

describe('testPayPal', () => {
  it('asks PayPal sandbox for a token with the client ID and secret', async () => {
    const { calls, fetchImpl } = fakeFetch(() => Response.json({ access_token: 't', expires_in: 3600 }));
    expect(await testPayPal({ clientId: 'id', secret: 'shh' }, fetchImpl)).toEqual({ ok: true });
    expect(calls[0].url).toBe('https://api-m.sandbox.paypal.com/v1/oauth2/token');
    expect(calls[0].headers.get('authorization')).toBe(`Basic ${Buffer.from('id:shh').toString('base64')}`);
  });

  it('says when PayPal refuses the credentials', async () => {
    const { fetchImpl } = fakeFetch(() => Response.json({ error: 'invalid_client' }, { status: 401 }));
    expect(await testPayPal({ clientId: 'id', secret: 'bad' }, fetchImpl)).toEqual({
      ok: false,
      error: 'PayPal sandbox refused these credentials (401).',
    });
  });
});

describe('testCredentials', () => {
  let dir: string;
  let file: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'settings-test-'));
    file = join(dir, 'settings.json');
  });
  afterEach(() => rm(dir, { recursive: true, force: true }));

  const env = { LLM_BASE_URL: 'https://env.example/v1', LLM_API_KEY: 'env-key', PAYPAL_CLIENT_ID: 'env-id', PAYPAL_SECRET: 'env-secret', SETTINGS_SECRET: 'a-long-settings-secret-for-tests' };
  const form: SettingsForm = {
    name: 'Shop', contactEmails: '', refundPolicy: 'Refund damaged orders of the ticket customer.', currency: 'USD',
    autoRefundUpTo: '100', approvalUpTo: '250', dailyCap: '200', provider: 'custom', baseUrl: 'https://saved.example/v1',
    agentModel: 'm', judgeModel: '', apiKey: 'saved-key', paypalClientId: 'saved-id', paypalSecret: 'saved-secret',
  };

  it('uses a typed key first, then a saved or environment key only for its own URL or client id', async () => {
    await saveSettings(form, { file, env });
    const blank = { ...form, apiKey: '', paypalSecret: '' };
    expect(await testCredentials({ ...blank, apiKey: 'typed' }, { file, env })).toMatchObject({ ai: { apiKey: 'typed' } });
    expect(await testCredentials(blank, { file, env })).toEqual({
      ai: { baseUrl: 'https://saved.example/v1', apiKey: 'saved-key' },
      paypal: { clientId: 'saved-id', secret: 'saved-secret' },
    });
    expect(await testCredentials({ ...blank, baseUrl: 'https://env.example/v1', paypalClientId: 'env-id' }, { file, env })).toEqual({
      ai: { baseUrl: 'https://env.example/v1', apiKey: 'env-key' },
      paypal: { clientId: 'env-id', secret: 'env-secret' },
    });
    expect(await testCredentials({ ...blank, baseUrl: 'https://attacker.example/v1', paypalClientId: 'other' }, { file, env })).toEqual({
      ai: { baseUrl: 'https://attacker.example/v1', apiKey: '' },
      paypal: { clientId: 'other', secret: '' },
    });
  });
});
