// The settings page's "Test connection" buttons: list an AI provider's models with its key, and
// ask PayPal sandbox for a token. Errors never repeat the key. Server-side only.

import { PAYPAL_API } from '@/lib/paypal';
import { normalizeBaseUrl } from './providers';

export type ModelList = { ok: true; models: string[] } | { ok: false; error: string };
export type ConnectionCheck = { ok: true } | { ok: false; error: string };

const TIMEOUT_MS = 10_000;

export async function listModels({ baseUrl, apiKey }: { baseUrl: string; apiKey: string }, fetchImpl: typeof fetch = fetch): Promise<ModelList> {
  const base = normalizeBaseUrl(baseUrl);
  const headers: Record<string, string> = apiKey ? { Authorization: `Bearer ${apiKey}` } : {};
  // Anthropic's model list takes its own key header.
  if (apiKey && URL.canParse(base) && new URL(base).hostname === 'api.anthropic.com') Object.assign(headers, { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' });
  let res: Response;
  try {
    res = await fetchImpl(`${base}/models`, { headers, cache: 'no-store', signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch (error) {
    return { ok: false, error: `Could not reach ${base} (${error instanceof Error ? error.message : 'no answer'})` };
  }
  if (!res.ok) {
    const body = (await res.text()).slice(0, 200).trim();
    return { ok: false, error: `The provider answered ${res.status}: ${apiKey ? body.replaceAll(apiKey, '••••') : body}` };
  }
  const { data } = (await res.json().catch(() => ({}))) as { data?: { id?: unknown }[] };
  const models = (data ?? []).map((model) => model.id).filter((id): id is string => typeof id === 'string');
  return { ok: true, models: models.sort() };
}

export async function testPayPal({ clientId, secret }: { clientId: string; secret: string }, fetchImpl: typeof fetch = fetch): Promise<ConnectionCheck> {
  try {
    const res = await fetchImpl(`${PAYPAL_API}/v1/oauth2/token`, {
      method: 'POST',
      headers: { Authorization: `Basic ${Buffer.from(`${clientId}:${secret}`).toString('base64')}`, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'grant_type=client_credentials',
      cache: 'no-store',
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    return res.ok ? { ok: true } : { ok: false, error: `PayPal sandbox refused these credentials (${res.status}).` };
  } catch (error) {
    return { ok: false, error: `Could not reach PayPal sandbox (${error instanceof Error ? error.message : 'no answer'})` };
  }
}
