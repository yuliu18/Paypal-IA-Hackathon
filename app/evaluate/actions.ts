'use server';

import { seedSandbox } from '@/lib/demo-seed';
import { evaluationCases } from '@/lib/evaluation/evaluation';

export type PreparedCase = { id: string; kind: 'business' | 'attack'; title: string; customer: string; message: string };
export type Prepared = { ok: true; cases: PreparedCase[] } | { ok: false; message: string };

// Starts a run from fresh sample payments, so the refund cases have something to refund. The proxy's
// demo password covers this action, like the page.
export async function prepareEvaluationAction(): Promise<Prepared> {
  try {
    const [ana, ben, carla] = await seedSandbox();
    return { ok: true, cases: evaluationCases({ ana, ben, carla }).map(({ id, kind, title, customer, message }) => ({ id, kind, title, customer, message })) };
  } catch (error) {
    console.error('Evaluation could not create sample payments', error);
    return { ok: false, message: 'The sample payments could not be created. Details are in the server log.' };
  }
}
