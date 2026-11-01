// The AG Studio AI assistant. The adapter calls `${endpoint}/responses`, i.e. this app's proxy at
// app/api/ai/responses, which holds the OpenAI key, so nothing secret is sent from the browser.

import { createAiHarness, type AgAiHarnessSetup, type AgAiPromptStarter } from 'ag-studio';
import type { Translate } from '../translate';
import { openaiAdapter } from './openai-adapter';

// Suggestions shown in a new AI conversation, before anything has been typed, in the app's language
// (`ai.<id>.label` and `ai.<id>.prompt` in the dashboard's messages).
const PROMPT_STARTERS = ['stoppedMost', 'protectedVsMoved', 'waiting', 'blockRate', 'summarise'];

const promptStarters = (t: Translate): AgAiPromptStarter[] =>
  PROMPT_STARTERS.map((id) => ({ label: t(`ai.${id}.label`), prompt: t(`ai.${id}.prompt`) }));

// `models` are the ids allowed by OPENAI_MODELS on the server; the first is the default, and the
// picker only shows for two or more.
export function buildAi(models: string[], t: Translate): AgAiHarnessSetup {
  const adapter = openaiAdapter({ endpoint: '/api/ai', model: models[0] });

  return ({ api }) =>
    createAiHarness(api, {
      adapter,
      promptStarters: promptStarters(t),
      models: models.length > 1 ? models.map((id) => ({ id, label: id })) : undefined,
    });
}
