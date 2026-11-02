'use server';

import { getTranslations } from 'next-intl/server';
import { seedSandbox } from '@/lib/demo-seed';
import { evaluationDispute } from '@/lib/evaluation/dispute';
import { cancellationNote, disputeNote, evaluationCases, fullEvaluationCases, type EvalCase } from '@/lib/evaluation/evaluation';
import { evaluationSubscription } from '@/lib/evaluation/subscription';

export type PreparedCase = Pick<EvalCase, 'id' | 'kind' | 'agent' | 'desk' | 'variant' | 'title' | 'customer' | 'message'>;
/** `note`: why cancellation or dispute cases are left out of this run, if any are. */
export type Prepared = { ok: true; cases: PreparedCase[]; note?: string } | { ok: false; message: string };

// Starts a run from fresh sample payments, so the refund cases have something to refund. The proxy's
// owner sign-in covers this action, like the page.
// `full`: every attack also as a jailbreak template and in base64, against both agents. The sample
// subscription, if any, is looked up for the cancellation cases (never re-created: the owner's
// cancellation uses it up). Likewise the sample dispute for the dispute cases.
export async function prepareEvaluationAction(full: boolean): Promise<Prepared> {
  try {
    const [ana, ben, carla] = await seedSandbox();
    const [subscription, dispute] = await Promise.all([evaluationSubscription(), evaluationDispute()]);
    const seed = { ana, ben, carla, subscription, dispute };
    const cases = (full ? fullEvaluationCases : evaluationCases)(seed);
    return {
      ok: true,
      cases: cases.map(({ id, kind, agent, desk, variant, title, customer, message }) => ({ id, kind, agent, desk, variant, title, customer, message })),
      note: [cancellationNote(seed), disputeNote(seed)].filter(Boolean).join(' ') || undefined,
    };
  } catch (error) {
    console.error('Evaluation could not create sample payments', error);
    return { ok: false, message: (await getTranslations('evaluate'))('seedFailed') };
  }
}
