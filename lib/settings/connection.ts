// The settings page's "Test connection" buttons: list an AI provider's models with its key, and
// ask PayPal (the sandbox, or live PayPal for the live app) for a token. Errors never repeat the key. Server-side only.

import { clientHeaders } from '@/lib/llm/openai-compatible';
import { payPalApi, type PaymentEnvironment } from '@/lib/paypal';
import { normalizeBaseUrl } from './providers';

export type ModelList = { ok: true; models: string[] } | { ok: false; error: string };
export type ConnectionCheck = { ok: true } | { ok: false; error: string };

const TIMEOUT_MS = 10_000;

const hideKey = (text: string, apiKey: string) => (apiKey ? text.replaceAll(apiKey, '••••') : text);
const providerError = async (res: Response, apiKey: string) =>
  `The provider answered ${res.status}: ${hideKey((await res.text()).slice(0, 200).trim(), apiKey)}`;

// The provider's models. A provider without a model list (OpenCode Go) is checked with a one-token
// chat to `model` instead, and lists none: the owner types the model id.
export async function listModels(
  { baseUrl, apiKey, model = '' }: { baseUrl: string; apiKey: string; model?: string },
  fetchImpl: typeof fetch = fetch,
): Promise<ModelList> {
  const base = normalizeBaseUrl(baseUrl);
  const headers: Record<string, string> = { ...clientHeaders(), ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}) };
  // Anthropic's model list takes its own key header.
  if (apiKey && URL.canParse(base) && new URL(base).hostname === 'api.anthropic.com') Object.assign(headers, { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' });
  const request = (path: string, init: RequestInit = {}) =>
    fetchImpl(`${base}${path}`, { ...init, headers: { ...headers, ...init.headers }, cache: 'no-store', signal: AbortSignal.timeout(TIMEOUT_MS) });
  try {
    const res = await request('/models');
    if (res.ok) {
      const { data } = (await res.json().catch(() => ({}))) as { data?: { id?: unknown }[] };
      const models = (data ?? []).map((m) => m.id).filter((id): id is string => typeof id === 'string');
      return { ok: true, models: models.sort() };
    }
    if (res.status !== 404) return { ok: false, error: await providerError(res, apiKey) };
    if (!model.trim()) return { ok: false, error: 'This provider does not list its models: type the agent model id, then test again.' };
    const chat = await request('/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: model.trim(), max_tokens: 1, messages: [{ role: 'user', content: 'ping' }] }),
    });
    return chat.ok ? { ok: true, models: [] } : { ok: false, error: await providerError(chat, apiKey) };
  } catch (error) {
    // fetch's own errors can quote a header, key included.
    return { ok: false, error: `Could not reach ${base} (${hideKey(error instanceof Error ? error.message : 'no answer', apiKey)})` };
  }
}

// `environment`: 'live' asks live PayPal (api-m.paypal.com); anything else, the sandbox.
export async function testPayPal(
  { clientId, secret }: { clientId: string; secret: string },
  fetchImpl: typeof fetch = fetch,
  environment: PaymentEnvironment = 'sandbox',
): Promise<ConnectionCheck> {
  const name = environment === 'live' ? 'Live PayPal' : 'PayPal sandbox';
  try {
    const res = await fetchImpl(`${payPalApi(environment)}/v1/oauth2/token`, {
      method: 'POST',
      headers: { Authorization: `Basic ${Buffer.from(`${clientId}:${secret}`).toString('base64')}`, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'grant_type=client_credentials',
      cache: 'no-store',
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    return res.ok ? { ok: true } : { ok: false, error: `${name} refused these credentials (${res.status}).` };
  } catch (error) {
    return { ok: false, error: `Could not reach ${name} (${error instanceof Error ? error.message : 'no answer'})` };
  }
}
