import { llmConfig } from '@/lib/agent/handle-ticket';
import { TicketLimiter } from '@/lib/agent/ticket-limiter';
import { clientAddress } from '@/lib/demo-auth';
import { ASSISTANT_MAX_ENTRIES, ASSISTANT_MAX_QUESTION, askGuardAssistant } from '@/lib/guard/assistant';
import { auditLog } from '@/lib/guard/runtime';
import { requestCompletion } from '@/lib/llm/openai-compatible';
import { loadSettings } from '@/lib/settings/settings';

// The guard assistant on /guard (lib/guard/assistant.ts): answers the shop owner's question about
// the guard's decisions with the LLM chosen on /settings. Read-only: one chat completion with no
// tools, fed only masked, structured fields of the newest log entries. Behind the demo password
// like every route (proxy.ts).

const TIMEOUT_MS = 30_000;

// Each question spends LLM tokens: 30 per address per 10 minutes, one at a time, 2 at once overall.
const questions = new TicketLimiter({ perClient: 30, windowMs: 10 * 60_000, inFlightPerClient: 1, inFlight: 2 });

const error = (status: number, message: string, headers?: HeadersInit) => Response.json({ error: { message } }, { status, headers });

export async function POST(request: Request) {
  let body: { question?: unknown };
  try {
    body = await request.json();
  } catch {
    return error(400, 'Request body must be JSON.');
  }
  if (!body || typeof body !== 'object') return error(400, 'Request body must be a JSON object.');
  const { question } = body;
  if (typeof question !== 'string' || !question.trim()) return error(400, 'question must be a non-empty string.');
  if (question.length > ASSISTANT_MAX_QUESTION) return error(400, `question must be at most ${ASSISTANT_MAX_QUESTION} characters.`);

  const slot = questions.acquire(clientAddress(request.headers), Date.now());
  if (!slot.ok) {
    const seconds = Math.ceil(slot.retryAfterMs / 1000);
    const message =
      slot.reason === 'quota' ? `Too many questions from this address. Try again in ${seconds} seconds.` : 'The guard assistant is busy. Try again in a few seconds.';
    return error(429, message, { 'Retry-After': String(seconds) });
  }

  try {
    const llm = await llmConfig((await loadSettings()).ai);
    const config = { baseUrl: llm.baseUrl, apiKey: llm.apiKey, model: llm.agentModel, headers: llm.headers, timeoutMs: TIMEOUT_MS };
    const answer = await askGuardAssistant({
      question,
      entries: await auditLog().list(ASSISTANT_MAX_ENTRIES),
      now: new Date(),
      complete: (request) => requestCompletion(config, request),
    });
    return Response.json({ answer });
  } catch (cause) {
    // The cause can carry provider responses, configuration names or the database path.
    console.error('Guard assistant failed', cause);
    return error(502, 'The guard assistant failed. Details are in the server log.');
  } finally {
    slot.release();
  }
}
