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
export async function requestCompletion(
  { baseUrl, apiKey, model, timeoutMs, headers = {} }: OpenAiCompatibleConfig,
  body: Record<string, unknown>,
): Promise<CompletionMessage> {
  const res = await fetch(`${baseUrl.replace(/\/$/, '')}/chat/completions`, {
    method: 'POST',
    headers: { ...headers, Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, temperature: 0, ...body }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) throw new Error(`LLM ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const parsed = (await res.json()) as { choices?: { message?: CompletionMessage }[] };
  const message = parsed.choices?.[0]?.message;
  if (!message) throw new Error('empty completion');
  return message;
}
