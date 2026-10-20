// `ToolChat` against any OpenAI-compatible `/chat/completions` endpoint with function calling
// (OpenAI, OpenCode Go, local servers...). The timeout bounds a hung provider.

import { requestCompletion, type OpenAiCompatibleConfig } from '@/lib/llm/openai-compatible';
import type { ToolChat } from './support-agent';

export function openAiCompatibleToolChat({
  timeoutMs = 60_000,
  ...config
}: Omit<OpenAiCompatibleConfig, 'timeoutMs'> & { timeoutMs?: number }): ToolChat {
  return async (messages, tools) => {
    const message = await requestCompletion(
      { ...config, timeoutMs },
      { messages, tools: tools.map(({ name, description, parameters }) => ({ type: 'function', function: { name, description, parameters } })) },
    );
    return { role: 'assistant', content: message.content ?? null, ...(message.tool_calls?.length ? { tool_calls: message.tool_calls } : {}) };
  };
}
