// The AI providers the settings page offers. Every one serves an OpenAI-compatible
// `/chat/completions` with tool calling, which is all the agent and the judge need; any other
// such endpoint works as "custom". Models are listed live from the provider, never hard-coded.

export type Provider = { id: string; label: string; group: 'Global' | 'China' | 'Local' | 'Gateway'; baseUrl: string; keyRequired: boolean };

export const PROVIDERS: Provider[] = [
  { id: 'anthropic', label: 'Anthropic (Claude)', group: 'Global', baseUrl: 'https://api.anthropic.com/v1', keyRequired: true },
  { id: 'openai', label: 'OpenAI', group: 'Global', baseUrl: 'https://api.openai.com/v1', keyRequired: true },
  { id: 'gemini', label: 'Google Gemini', group: 'Global', baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai', keyRequired: true },
  { id: 'mistral', label: 'Mistral', group: 'Global', baseUrl: 'https://api.mistral.ai/v1', keyRequired: true },
  { id: 'xai', label: 'xAI (Grok)', group: 'Global', baseUrl: 'https://api.x.ai/v1', keyRequired: true },
  { id: 'deepseek', label: 'DeepSeek', group: 'China', baseUrl: 'https://api.deepseek.com/v1', keyRequired: true },
  { id: 'qwen', label: 'Qwen (Alibaba Model Studio)', group: 'China', baseUrl: 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1', keyRequired: true },
  { id: 'moonshot', label: 'Kimi (Moonshot)', group: 'China', baseUrl: 'https://api.moonshot.ai/v1', keyRequired: true },
  { id: 'zhipu', label: 'GLM (Z.ai)', group: 'China', baseUrl: 'https://api.z.ai/api/paas/v4', keyRequired: true },
  { id: 'minimax', label: 'MiniMax', group: 'China', baseUrl: 'https://api.minimax.io/v1', keyRequired: true },
  { id: 'openrouter', label: 'OpenRouter', group: 'Gateway', baseUrl: 'https://openrouter.ai/api/v1', keyRequired: true },
  { id: 'groq', label: 'Groq', group: 'Gateway', baseUrl: 'https://api.groq.com/openai/v1', keyRequired: true },
  { id: 'opencode-go', label: 'OpenCode Go', group: 'Gateway', baseUrl: 'https://opencode.ai/inference/go/openai/v1', keyRequired: true },
  { id: 'ollama', label: 'Ollama (this machine)', group: 'Local', baseUrl: 'http://localhost:11434/v1', keyRequired: false },
  { id: 'lmstudio', label: 'LM Studio (this machine)', group: 'Local', baseUrl: 'http://localhost:1234/v1', keyRequired: false },
];

export const normalizeBaseUrl = (url: string) => url.trim().replace(/\/+$/, '');

// The preset a base URL belongs to, or 'custom'.
export const providerFor = (baseUrl: string) => PROVIDERS.find((p) => p.baseUrl === normalizeBaseUrl(baseUrl))?.id ?? 'custom';
