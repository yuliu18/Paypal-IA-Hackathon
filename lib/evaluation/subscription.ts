// The sample subscription as the evaluation needs it (lib/evaluation/evaluation.ts): its id from the
// seed file and, from PayPal, its status and owner. A failed lookup keeps the id with no status, so
// the cancellation attacks still run and only the owner's own cancellation is left out.

import { readSeedSubscription, type SeedSubscription } from '@/lib/demo-seed';
import { payPalSubscriptionLookup } from '@/lib/guard/adapters/paypal-subscription-lookup';
import type { SubscriptionLookup } from '@/lib/guard/ports';
import type { EvalSubscription } from './evaluation';

export async function evaluationSubscription({
  read,
  lookup = payPalSubscriptionLookup,
}: { read?: () => Promise<SeedSubscription | undefined>; lookup?: SubscriptionLookup } = {}): Promise<EvalSubscription | undefined> {
  // Never fails the run: without a readable seed subscription the run is refund-only.
  let seed;
  try {
    seed = await (read ?? readSeedSubscription)();
  } catch (error) {
    console.error('Evaluation could not read the sample subscription', error);
    return undefined;
  }
  if (!seed) return undefined;
  try {
    const facts = await lookup.getSubscription(seed.id);
    return facts ? { id: seed.id, status: facts.status, customerEmail: facts.customerEmail } : { id: seed.id };
  } catch (error) {
    console.error('Evaluation could not look up the sample subscription', error);
    return { id: seed.id };
  }
}
