// The full AI catalog for the settings page, from models.dev: the open database of providers and
// models that OpenCode and Pi use. The verified presets (./providers) come first and keep their
// OpenAI-compatible URLs; every other provider models.dev serves through an OpenAI-compatible API
// follows. Only models that can call tools are listed, since the agent works through PayPal tools.
// Server-side: fetched once and kept for 6 hours; without models.dev the presets still work.

import { normalizeBaseUrl, PROVIDERS, type Provider } from './providers';

export type CatalogModel = { id: string; name: string; context?: number; input?: number; output?: number };
// `logo`: the provider's icon on models.dev.
export type CatalogProvider = Provider & { modelCount: number; logo: string };
export type Catalog = { providers: CatalogProvider[]; models: Map<string, CatalogModel[]> };

type RawModel = { id?: unknown; name?: unknown; tool_call?: unknown; release_date?: unknown; limit?: { context?: unknown }; cost?: { input?: unknown; output?: unknown } };
type RawProvider = { id?: unknown; name?: unknown; npm?: unknown; api?: unknown; models?: Record<string, RawModel> };

export const MODELS_DEV_URL = 'https://models.dev/api.json';
const logo = (id: string) => `https://models.dev/logos/${id}.svg`;

// The models.dev entry each preset takes its models from. Ollama runs whatever the owner pulled,
// so its models come from its own /models through "Test connection".
const PRESET_SOURCES: Record<string, string> = {
  anthropic: 'anthropic',
  openai: 'openai',
  gemini: 'google',
  mistral: 'mistral',
  xai: 'xai',
  deepseek: 'deepseek',
  qwen: 'alibaba',
  moonshot: 'moonshotai',
  zhipu: 'zai',
  minimax: 'minimax',
  openrouter: 'openrouter',
  groq: 'groq',
  'opencode-go': 'opencode-go',
  lmstudio: 'lmstudio',
};

const number = (value: unknown) => (typeof value === 'number' && Number.isFinite(value) ? value : undefined);

function toolModels(raw: RawProvider | undefined): CatalogModel[] {
  return Object.values(raw?.models ?? {})
    .filter((m) => m.tool_call === true && typeof m.id === 'string')
    .sort((a, b) => String(b.release_date ?? '').localeCompare(String(a.release_date ?? '')))
    .map((m) => {
      const model: CatalogModel = { id: m.id as string, name: typeof m.name === 'string' ? m.name : (m.id as string) };
      const context = number(m.limit?.context);
      const [input, output] = [number(m.cost?.input), number(m.cost?.output)];
      return { ...model, ...(context && { context }), ...(input !== undefined && { input }), ...(output !== undefined && { output }) };
    });
}

export function buildCatalog(raw: Record<string, RawProvider>): Catalog {
  const models = new Map<string, CatalogModel[]>();
  const providers: CatalogProvider[] = PROVIDERS.map((preset) => {
    const source = PRESET_SOURCES[preset.id];
    const list = source && Object.hasOwn(raw, source) ? toolModels(raw[source]) : [];
    if (list.length) models.set(preset.id, list);
    return { ...preset, modelCount: list.length, logo: logo(PRESET_SOURCES[preset.id] ?? preset.id) };
  });
  // 'custom' is the page's own "any URL" choice: no catalog entry may take its id.
  const taken = new Set(['custom', ...PROVIDERS.map((p) => p.id), ...Object.values(PRESET_SOURCES)]);
  const more = Object.entries(raw)
    .filter(([id, p]) => !taken.has(id) && /^[a-z0-9-]{1,40}$/.test(id) && p.npm === '@ai-sdk/openai-compatible' && typeof p.api === 'string' && /^https?:\/\//.test(p.api))
    .map(([id, p]): CatalogProvider => {
      const list = toolModels(p);
      if (list.length) models.set(id, list);
      return { id, label: typeof p.name === 'string' ? p.name : id, group: 'More providers', baseUrl: normalizeBaseUrl(p.api as string), keyRequired: true, modelCount: list.length, logo: logo(id) };
    })
    .sort((a, b) => a.label.localeCompare(b.label));
  return { providers: [...providers, ...more], models };
}

const CACHE_MS = 6 * 60 * 60_000;
const RETRY_MS = 60_000;

// Callers that arrive together share one request. Once a catalog is cached, callers get it at
// once and a due refresh runs in the background, so a slow or down models.dev never delays a page;
// only the very first load waits (up to 10 s).
export function createCatalogLoader(fetchImpl: typeof fetch = fetch, now: () => number = Date.now) {
  let cached: { catalog: Catalog; until: number; complete: boolean } | undefined;
  let inFlight: Promise<Catalog> | undefined;

  async function refresh(): Promise<Catalog> {
    try {
      const res = await fetchImpl(MODELS_DEV_URL, { signal: AbortSignal.timeout(10_000) });
      if (!res.ok) throw new Error(`models.dev answered ${res.status}`);
      cached = { catalog: buildCatalog((await res.json()) as Record<string, RawProvider>), until: now() + CACHE_MS, complete: true };
    } catch (error) {
      // A stale full catalog beats the presets alone; either way, try again in a minute.
      const keep = cached?.complete ? cached.catalog : undefined;
      console.error(`The models.dev catalog could not be loaded; ${keep ? 'keeping the last one' : 'offering the built-in providers only'}`, error);
      cached = { catalog: keep ?? buildCatalog({}), until: now() + RETRY_MS, complete: !!keep };
    }
    return cached.catalog;
  }

  return async function loadCatalog(): Promise<Catalog> {
    if (cached && now() < cached.until) return cached.catalog;
    inFlight ??= refresh().finally(() => (inFlight = undefined));
    return cached ? cached.catalog : inFlight;
  };
}

export const loadCatalog = createCatalogLoader();
