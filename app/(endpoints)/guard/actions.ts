'use server';

import { refresh } from 'next/cache';
import { getTranslations } from 'next-intl/server';
import { decideHeld } from '@/lib/agent/handle-ticket';
import type { HeldDecision } from '@/lib/guard/guard';
import { shopOrigin } from '@/lib/shop/checkout';

export type DecideState = HeldDecision | null;

// Approve or reject one held call from the /guard page. A held order is re-checked against the
// shop's origin, as the sales desk created it (APP_URL, else the local dev server: lib/shop/checkout.ts shopOrigin).
// The proxy's owner sign-in already covers this action, since Server Actions post to the page's
// own route.
export async function decideHeldAction(_previous: DecideState, form: FormData): Promise<DecideState> {
  const id = form.get('id');
  const decision = form.get('decision');
  if (typeof id !== 'string' || !/^\d+$/.test(id) || (decision !== 'approve' && decision !== 'reject')) {
    return { outcome: 'refused', message: (await getTranslations('guard.held'))('invalidRequest') };
  }
  try {
    const result = await decideHeld(id, decision === 'approve', { shopOrigin: shopOrigin() });
    refresh();
    return result;
  } catch (error) {
    // Details stay in the server log, as in the tickets API.
    console.error('Held call decision failed', error);
    return { outcome: 'error', message: (await getTranslations('guard.held'))('failed') };
  }
}
