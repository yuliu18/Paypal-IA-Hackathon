'use server';

import { headers } from 'next/headers';
import { refresh } from 'next/cache';
import { decideHeld } from '@/lib/agent/handle-ticket';
import type { HeldDecision } from '@/lib/guard/guard';
import { shopOrigin } from '@/lib/shop/checkout';

export type DecideState = HeldDecision | null;

// Approve or reject one held call from the /guard page. A held order is re-checked against this
// request's origin as the shop's, as the sales desk created it (lib/shop/checkout.ts shopOrigin).
// The proxy's demo password already covers this action, since Server Actions post to the page's
// own route.
export async function decideHeldAction(_previous: DecideState, form: FormData): Promise<DecideState> {
  const id = form.get('id');
  const decision = form.get('decision');
  if (typeof id !== 'string' || !/^\d+$/.test(id) || (decision !== 'approve' && decision !== 'reject')) {
    return { outcome: 'refused', message: 'Invalid decision request' };
  }
  try {
    const result = await decideHeld(id, decision === 'approve', { shopOrigin: shopOrigin((await headers()).get('origin')) });
    refresh();
    return result;
  } catch (error) {
    // Details stay in the server log, as in the tickets API.
    console.error('Held call decision failed', error);
    return { outcome: 'error', message: 'The decision could not be processed; nothing was recorded.' };
  }
}
