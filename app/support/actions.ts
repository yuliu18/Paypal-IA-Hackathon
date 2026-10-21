'use server';

import { refresh } from 'next/cache';
import { seedSandbox } from '@/lib/demo-seed';

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
