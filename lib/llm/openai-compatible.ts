// One request to an OpenAI-compatible `/chat/completions` endpoint, shared by the guard's intent
// judge and the support agent so headers, timeouts and error handling stay the same in both.

// OpenCode Go rejects requests without a client user agent and a session id; other providers ignore them.
export const clientHeaders = (): Record<string, string> => ({ 'User-Agent': 'payment-guard/0.1', 'x-opencode-session': crypto.randomUUID() });

export type OpenAiCompatibleConfig = {
  baseUrl: string;
  apiKey: string;
  model: string;
  timeoutMs: number;
  // Provider-specific headers, e.g. OpenCode Go asks for a client user agent and `x-opencode-session`.
  headers?: Record<string, string>;
};

export type CompletionMessage = {
  content?: string | null;
  tool_calls?: { id: string; type: 'function'; function: { name: string; arguments: string } }[];
};

// `body` carries the request fields beyond the model (messages, tools...). The timeout bounds a hung
// provider; any non-2xx answer or missing message throws.
// Temperature 0 keeps answers as steady as the model allows. Some models (often reasoning ones)
// accept only their own temperature and answer 400: they are asked once more without one.
export async function requestCompletion(
  { baseUrl, apiKey, model, timeoutMs, headers = {} }: OpenAiCompatibleConfig,
  body: Record<string, unknown>,
): Promise<CompletionMessage> {
  const signal = AbortSignal.timeout(timeoutMs);
  const send = (fields: Record<string, unknown>) =>
    fetch(`${baseUrl.replace(/\/$/, '')}/chat/completions`, {
      method: 'POST',
      headers: { ...headers, Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(fields),
      signal,
    });
  let res = await send({ model, temperature: 0, ...body });
  if (res.status === 400) {
    const refusal = await res.text();
    if (!/temperature/i.test(refusal)) throw new Error(`LLM 400: ${refusal.slice(0, 200)}`);
    res = await send({ model, ...body });
  }
  if (!res.ok) throw new Error(`LLM ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const parsed = (await res.json()) as { choices?: { message?: CompletionMessage }[] };
  const message = parsed.choices?.[0]?.message;
  if (!message) throw new Error('empty completion');
  return message;
}
