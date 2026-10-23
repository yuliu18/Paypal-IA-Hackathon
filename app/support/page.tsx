import type { Metadata } from 'next';
import { connection } from 'next/server';
import { readSeed, readSeedSubscription } from '@/lib/demo-seed';
import { payPalSubscriptionLookup } from '@/lib/guard/adapters/paypal-subscription-lookup';
import type { SubscriptionFacts } from '@/lib/guard/domain/cancellation';
import { buildScenarios, pendingApproval } from './scenarios';
import { SupportDesk } from './support-desk';

export const metadata: Metadata = { title: 'Support agent demo' };

// The sample subscription as PayPal reports it now: its owner is whoever approved it. Undefined
// when there is none or PayPal can't be reached, which leaves its tickets out.
async function sampleSubscription(id: string | undefined): Promise<SubscriptionFacts | undefined> {
  if (!id) return undefined;
  try {
    return await payPalSubscriptionLookup.getSubscription(id);
  } catch (error) {
    console.error('Sample subscription could not be read', error);
    return undefined;
  }
}

export default async function SupportPage() {
  await connection();
  const [charges, seedSubscription] = await Promise.all([readSeed(), readSeedSubscription()]);
  const subscription = await sampleSubscription(seedSubscription?.id);
  return <SupportDesk scenarios={buildScenarios(charges, subscription)} pendingApproveUrl={pendingApproval(seedSubscription, subscription)} />;
}
