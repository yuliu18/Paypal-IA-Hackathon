'use server';

import { refresh } from 'next/cache';
import { decideHeld } from '@/lib/agent/handle-ticket';
import type { HeldRefundDecision } from '@/lib/guard/guard';

export type DecideState = HeldRefundDecision | null;

// Approve or reject one held refund from the /guard page. The proxy's demo password already
// covers this action, since Server Actions post to the page's own route.
export async function decideHeldAction(_previous: DecideState, form: FormData): Promise<DecideState> {
  const id = form.get('id');
  const decision = form.get('decision');
  if (typeof id !== 'string' || !/^\d+$/.test(id) || (decision !== 'approve' && decision !== 'reject')) {
    return { outcome: 'refused', message: 'Invalid decision request' };
  }
  try {
    const result = await decideHeld(id, decision === 'approve');
    refresh();
    return result;
  } catch (error) {
    // Details stay in the server log, as in the tickets API.
    console.error('Held refund decision failed', error);
    return { outcome: 'error', message: 'The decision could not be processed; nothing was recorded.' };
  }
}
