import { describe, expect, it } from 'vitest';
import { buildCatalog, createCatalogLoader } from './catalog';
import { PROVIDERS } from './providers';

// Shaped like https://models.dev/api.json.
const RAW = {
  deepseek: {
    id: 'deepseek',
    name: 'DeepSeek',
    npm: '@ai-sdk/openai-compatible',
    api: 'https://api.deepseek.com',
    models: {
      'deepseek-old': { id: 'deepseek-old', name: 'DeepSeek Old', tool_call: true, release_date: '2025-01-01', limit: { context: 64000 }, cost: { input: 0.27, output: 1.1 } },
      'deepseek-new': { id: 'deepseek-new', name: 'DeepSeek New', tool_call: true, release_date: '2026-10-01', limit: { context: 128000 }, cost: { input: 0.3, output: 1.2 } },
      'deepseek-ocr': { id: 'deepseek-ocr', name: 'DeepSeek OCR', tool_call: false, release_date: '2026-09-01' },
    },
  },
  minimax: { id: 'minimax', name: 'MiniMax', npm: '@ai-sdk/anthropic', api: 'https://api.minimax.io/anthropic/v1', models: { m3: { id: 'm3', name: 'M3', tool_call: true } } },
  fireworks: { id: 'fireworks', name: 'Fireworks', npm: '@ai-sdk/openai-compatible', api: 'https://api.fireworks.ai/inference/v1/', models: { f1: { id: 'f1', name: 'F1', tool_call: true } } },
  vertex: { id: 'vertex', name: 'Vertex', npm: '@ai-sdk/google-vertex', models: { v: { id: 'v', name: 'V', tool_call: true } } },
  'Bad Id': { id: 'Bad Id', name: 'Bad', npm: '@ai-sdk/openai-compatible', api: 'https://bad.example/v1', models: {} },
};

describe('buildCatalog', () => {
  const catalog = buildCatalog(RAW);

  it('keeps the presets first, with their verified URLs, and adds their models.dev models that can call tools, newest first', () => {
    expect(catalog.providers.slice(0, PROVIDERS.length).map((p) => p.id)).toEqual(PROVIDERS.map((p) => p.id));
    expect(catalog.providers.find((p) => p.id === 'deepseek')).toMatchObject({ baseUrl: 'https://api.deepseek.com/v1', modelCount: 2 });
    expect(catalog.models.get('deepseek')).toEqual([
      { id: 'deepseek-new', name: 'DeepSeek New', context: 128000, input: 0.3, output: 1.2 },
      { id: 'deepseek-old', name: 'DeepSeek Old', context: 64000, input: 0.27, output: 1.1 },
    ]);
    expect(catalog.providers.find((p) => p.id === 'minimax')?.baseUrl).toBe('https://api.minimax.io/v1');
    expect(catalog.providers.find((p) => p.id === 'qwen')?.logo).toBe('https://models.dev/logos/alibaba.svg');
    expect(catalog.models.get('minimax')?.map((m) => m.id)).toEqual(['m3']);
  });

  it('adds every other OpenAI-compatible provider, and only those', () => {
    const more = catalog.providers.filter((p) => p.group === 'More providers');
    expect(more).toEqual([{ id: 'fireworks', label: 'Fireworks', group: 'More providers', baseUrl: 'https://api.fireworks.ai/inference/v1', keyRequired: true, modelCount: 1, logo: 'https://models.dev/logos/fireworks.svg' }]);
  });
});

describe('buildCatalog with a hostile catalog', () => {
  it("never takes the custom provider's id or gives Ollama models through a key named undefined", () => {
    const hostile = buildCatalog({
      custom: { npm: '@ai-sdk/openai-compatible', api: 'https://evil.example/v1', models: {} },
      undefined: { npm: '@ai-sdk/openai-compatible', api: 'https://evil.example/v1', models: { x: { id: 'x', name: 'X', tool_call: true } } },
    });
    expect(hostile.providers.some((p) => p.id === 'custom')).toBe(false);
    expect(hostile.models.get('ollama')).toBeUndefined();
  });
});

describe('createCatalogLoader', () => {
  it('fetches models.dev once and serves the cached catalog', async () => {
    let calls = 0;
    const load = createCatalogLoader(async () => {
      calls++;
      return Response.json(RAW);
    });
    await load();
    const catalog = await load();
    expect(calls).toBe(1);
    expect(catalog.models.get('deepseek')).toHaveLength(2);
  });

  it('makes one request for callers that arrive together', async () => {
    let calls = 0;
    const load = createCatalogLoader(async () => {
      calls++;
      return Response.json(RAW);
    });
    await Promise.all([load(), load(), load()]);
    expect(calls).toBe(1);
  });

  it('answers at once from the cache while a due refresh runs in the background', async () => {
    let now = 0;
    let release: (() => void) | undefined;
    let calls = 0;
    const load = createCatalogLoader(async () => {
      calls++;
      if (calls > 1) await new Promise<void>((resolve) => (release = resolve));
      return Response.json(RAW);
    }, () => now);
    await load();
    now += 7 * 60 * 60_000;
    const answer = await Promise.race([load().then(() => 'cached'), new Promise((resolve) => setTimeout(() => resolve('waited'), 50))]);
    expect(answer).toBe('cached');
    expect(calls).toBe(2);
    release?.();
  });

  it('keeps the last good catalog when a refresh fails', async () => {
    let now = 0;
    let up = true;
    const load = createCatalogLoader(async () => {
      if (!up) throw new TypeError('fetch failed');
      return Response.json(RAW);
    }, () => now);
    await load();
    up = false;
    now += 7 * 60 * 60_000;
    await load();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect((await load()).models.get('deepseek')).toHaveLength(2);
  });

  it('falls back to the presets without models when models.dev is unreachable, and retries later', async () => {
    let now = 0;
    let up = false;
    const load = createCatalogLoader(async () => {
      if (!up) throw new TypeError('fetch failed');
      return Response.json(RAW);
    }, () => now);
    const offline = await load();
    expect(offline.providers.map((p) => p.id)).toEqual(PROVIDERS.map((p) => p.id));
    expect(offline.models.size).toBe(0);
    up = true;
    now += 2 * 60_000;
    // The due retry runs in the background: this call still gets the presets, the next the full catalog.
    expect((await load()).models.size).toBe(0);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect((await load()).models.get('deepseek')).toHaveLength(2);
  });
});
