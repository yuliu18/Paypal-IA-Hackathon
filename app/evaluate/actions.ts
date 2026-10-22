'use server';

import { seedSandbox } from '@/lib/demo-seed';
import { evaluationCases, fullEvaluationCases, type EvalCase } from '@/lib/evaluation/evaluation';

export type PreparedCase = Pick<EvalCase, 'id' | 'kind' | 'agent' | 'variant' | 'title' | 'customer' | 'message'>;
export type Prepared = { ok: true; cases: PreparedCase[] } | { ok: false; message: string };

// Starts a run from fresh sample payments, so the refund cases have something to refund. The proxy's
// demo password covers this action, like the page.
// `full`: every attack also as a jailbreak template and in base64, against both agents.
export async function prepareEvaluationAction(full: boolean): Promise<Prepared> {
  try {
    const [ana, ben, carla] = await seedSandbox();
    const cases = (full ? fullEvaluationCases : evaluationCases)({ ana, ben, carla });
    return { ok: true, cases: cases.map(({ id, kind, agent, variant, title, customer, message }) => ({ id, kind, agent, variant, title, customer, message })) };
  } catch (error) {
    console.error('Evaluation could not create sample payments', error);
    return { ok: false, message: 'The sample payments could not be created. Details are in the server log.' };
  }
}
