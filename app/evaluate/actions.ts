'use server';

import { seedSandbox } from '@/lib/demo-seed';
import { cancellationNote, evaluationCases, fullEvaluationCases, type EvalCase } from '@/lib/evaluation/evaluation';
import { evaluationSubscription } from '@/lib/evaluation/subscription';

export type PreparedCase = Pick<EvalCase, 'id' | 'kind' | 'agent' | 'variant' | 'title' | 'customer' | 'message'>;
/** `note`: why cancellation cases are left out of this run, if any are. */
export type Prepared = { ok: true; cases: PreparedCase[]; note?: string } | { ok: false; message: string };

// Starts a run from fresh sample payments, so the refund cases have something to refund. The proxy's
// demo password covers this action, like the page.
// `full`: every attack also as a jailbreak template and in base64, against both agents. The sample
// subscription, if any, is looked up for the cancellation cases (never re-created: the owner's
// cancellation uses it up).
export async function prepareEvaluationAction(full: boolean): Promise<Prepared> {
  try {
    const [ana, ben, carla] = await seedSandbox();
    const seed = { ana, ben, carla, subscription: await evaluationSubscription() };
    const cases = (full ? fullEvaluationCases : evaluationCases)(seed);
    return {
      ok: true,
      cases: cases.map(({ id, kind, agent, variant, title, customer, message }) => ({ id, kind, agent, variant, title, customer, message })),
      note: cancellationNote(seed),
    };
  } catch (error) {
    console.error('Evaluation could not create sample payments', error);
    return { ok: false, message: 'The sample payments could not be created. Details are in the server log.' };
  }
}
