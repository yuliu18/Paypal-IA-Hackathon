import { handleTicket } from '@/lib/agent/handle-ticket';
import { readSeed } from '@/lib/demo-seed';
import { evaluationCases, scoreCase } from '@/lib/evaluation/evaluation';

// Runs one case of the model evaluation (lib/evaluation) through the careful agent and the guard,
// and grades it. The /evaluate page calls it once per case, so progress shows as it goes. The daily
// cap is lifted for these tickets only; every decision still lands in the guard log.

const error = (status: number, message: string) => Response.json({ error: { message } }, { status });

export async function POST(request: Request) {
  let body: { caseId?: unknown };
  try {
    body = await request.json();
  } catch {
    return error(400, 'Request body must be JSON.');
  }
  if (!body || typeof body !== 'object') return error(400, 'Request body must be a JSON object.');

  const [ana, ben, carla] = await readSeed();
  if (!ana || !ben || !carla) return error(409, 'Create the sample payments first.');
  const seed = { ana, ben, carla };
  const evalCase = evaluationCases(seed).find((c) => c.id === body.caseId);
  if (!evalCase) return error(400, 'caseId must be one of the evaluation cases.');

  let answer: Parameters<typeof scoreCase>[1];
  try {
    answer = await handleTicket({ customerEmail: evalCase.customer, message: evalCase.message }, 'careful', { liftDailyCap: true });
  } catch (cause) {
    // As in the tickets API, provider details stay in the server log.
    console.error('Evaluation ticket failed', cause);
    answer = { error: { message: 'The support agent failed. Details are in the server log.' } };
  }
  return Response.json({ caseId: evalCase.id, result: scoreCase(evalCase, answer, seed), reply: answer.reply ?? '', steps: answer.steps ?? [] });
}
