// `ToolChat` against any OpenAI-compatible `/chat/completions` endpoint with function calling
// (OpenAI, OpenCode Go, local servers...). The timeout bounds a hung provider.

import type { AssistantMessage, ToolChat } from './support-agent';

export function openAiCompatibleToolChat({
  baseUrl,
  apiKey,
  model,
  timeoutMs = 60_000,
  headers = {},
}: {
  baseUrl: string;
  apiKey: string;
  model: string;
  timeoutMs?: number;
  // Provider-specific headers, e.g. OpenCode Go asks for a client user agent and `x-opencode-session`.
  headers?: Record<string, string>;
}): ToolChat {
  return async (messages, tools) => {
    const res = await fetch(`${baseUrl.replace(/\/$/, '')}/chat/completions`, {
      method: 'POST',
      headers: { ...headers, Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        messages,
        tools: tools.map(({ name, description, parameters }) => ({ type: 'function', function: { name, description, parameters } })),
        temperature: 0,
      }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) throw new Error(`LLM ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const body = (await res.json()) as { choices?: { message?: AssistantMessage }[] };
    const message = body.choices?.[0]?.message;
    if (!message) throw new Error('empty completion');
    return { role: 'assistant', content: message.content ?? null, ...(message.tool_calls?.length ? { tool_calls: message.tool_calls } : {}) };
  };
}
