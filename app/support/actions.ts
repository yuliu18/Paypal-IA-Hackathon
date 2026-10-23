'use server';

import { refresh } from 'next/cache';
import { seedSandbox } from '@/lib/demo-seed';
import { createSampleSubscription } from '@/lib/demo-subscription';

export type SeedState = { ok: boolean; message: string } | null;

// Creates new sample payments in the PayPal sandbox, as `npm run seed` does, so a deployed demo
// needs no shell. The proxy's demo password covers this action, like the page.
export async function createSamplePaymentsAction(): Promise<SeedState> {
  try {
    const charges = await seedSandbox();
    refresh();
    return { ok: true, message: `Created ${charges.length} sandbox payments.` };
  } catch (error) {
    // Details stay in the server log, as in the tickets API.
    console.error('Sample payments could not be created', error);
    return { ok: false, message: 'The sample payments could not be created. Details are in the server log.' };
  }
}

export type SubscriptionState = { ok: true; approveUrl: string; subscriptionId: string } | { ok: false; message: string } | null;

// Creates the sample subscription in the PayPal sandbox and returns the link a sandbox buyer opens
// to approve it. Covered by the demo password like the action above.
export async function createSampleSubscriptionAction(): Promise<SubscriptionState> {
  try {
    const { subscriptionId, approveUrl } = await createSampleSubscription();
    refresh();
    return { ok: true, subscriptionId, approveUrl };
  } catch (error) {
    console.error('Sample subscription could not be created', error);
    return { ok: false, message: 'The sample subscription could not be created. Details are in the server log.' };
  }
}
