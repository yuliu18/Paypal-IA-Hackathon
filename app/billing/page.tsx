import type { Metadata } from 'next';
import { connection } from 'next/server';
import { readSeed } from '@/lib/demo-seed';
import { BillingDesk } from './billing-desk';
import { buildBillingScenarios } from './scenarios';

export const metadata: Metadata = { title: 'Billing agent' };

export default async function BillingPage() {
  await connection();
  return <BillingDesk scenarios={buildBillingScenarios(await readSeed())} />;
}
