'use server';

import { headers } from 'next/headers';
import { getTranslations } from 'next-intl/server';
import { refresh } from 'next/cache';
import { seedSandbox } from '@/lib/demo-seed';
import { createSampleDisputePayment } from '@/lib/demo-dispute-payment';
import { createSampleSubscription } from '@/lib/demo-subscription';

export type SeedState = { ok: boolean; message: string } | null;

// Creates new sample payments in the PayPal sandbox, as `npm run seed` does, so a deployed demo
// needs no shell. The proxy's demo password covers this action, like the page.
export async function createSamplePaymentsAction(): Promise<SeedState> {
  const t = await getTranslations('desks.seed');
  try {
    const charges = await seedSandbox();
    refresh();
    return { ok: true, message: t('created', { count: charges.length }) };
  } catch (error) {
    // Details stay in the server log, as in the tickets API.
    console.error('Sample payments could not be created', error);
    return { ok: false, message: t('failed') };
  }
}

export type SubscriptionState = { ok: true; approveUrl: string; subscriptionId: string } | { ok: false; message: string } | null;

// Creates the sample subscription in the PayPal sandbox and returns the link a sandbox buyer opens
// to approve it. Covered by the demo password like the action above.
export async function createSampleSubscriptionAction(): Promise<SubscriptionState> {
  const t = await getTranslations('desks.subscription');
  try {
    // The buyer comes back to the app they started from (this request's origin), else APP_URL.
    const origin = (await headers()).get('origin') ?? undefined;
    const { subscriptionId, approveUrl } = await createSampleSubscription({ appUrl: origin });
    refresh();
    return { ok: true, subscriptionId, approveUrl };
  } catch (error) {
    console.error('Sample subscription could not be created', error);
    return { ok: false, message: t('failed') };
  }
}

export type DisputePaymentState = { ok: true; approveUrl: string } | { ok: false; message: string } | null;

// Creates the sample PayPal payment a sandbox buyer pays and can then dispute, and returns the link
// to pay it. Covered by the demo password like the actions above.
export async function createSampleDisputePaymentAction(): Promise<DisputePaymentState> {
  const t = await getTranslations('desks.disputePayment');
  try {
    const origin = (await headers()).get('origin') ?? undefined;
    const { approveUrl } = await createSampleDisputePayment({ appUrl: origin });
    refresh();
    return { ok: true, approveUrl };
  } catch (error) {
    console.error('Sample PayPal payment could not be created', error);
    return { ok: false, message: t('failed') };
  }
}
