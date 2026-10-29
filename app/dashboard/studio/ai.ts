// The AG Studio AI assistant. The adapter calls `${endpoint}/responses`, i.e. this app's proxy at
// app/api/ai/responses, which holds the OpenAI key, so nothing secret is sent from the browser.

import { createAiHarness, type AgAiHarnessSetup, type AgAiPromptStarter } from 'ag-studio';
import { openaiAdapter } from './openai-adapter';

// Suggestions shown in a new AI conversation, before anything has been typed.
const PROMPT_STARTERS: AgAiPromptStarter[] = [
  {
    label: 'Which agent was stopped most?',
    prompt: 'Which AI agent did the payment guard stop most often, and for which reasons? Use the guard decisions and violations.',
  },
  {
    label: 'Money protected vs moved',
    prompt: 'How much money did the guard protect by blocking, compared with what the agents moved and billed? Break it down by agent and action.',
  },
  {
    label: 'What waits for a person?',
    prompt: 'List the held actions still awaiting approval, oldest first, with the agent, action, customer and amount.',
  },
  {
    label: 'Chart the block rate',
    prompt: 'Add a line chart of the guard block rate per day, split by agent.',
  },
  {
    label: 'Summarise this page',
    prompt: 'Summarise what this page shows: every widget, the fields it reads, and what stands out.',
  },
];

// `models` are the ids allowed by OPENAI_MODELS on the server; the first is the default, and the
// picker only shows for two or more.
export function buildAi(models: string[]): AgAiHarnessSetup {
  const adapter = openaiAdapter({ endpoint: '/api/ai', model: models[0] });

  return ({ api }) =>
    createAiHarness(api, {
      adapter,
      promptStarters: PROMPT_STARTERS,
      models: models.length > 1 ? models.map((id) => ({ id, label: id })) : undefined,
    });
}
