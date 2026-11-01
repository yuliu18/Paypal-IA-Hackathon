import type { Metadata } from 'next';
import { connection } from 'next/server';
import { getTranslations } from 'next-intl/server';
import { readSeed } from '@/lib/demo-seed';
import { BillingDesk } from './billing-desk';
import { buildBillingScenarios } from './scenarios';

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations('desks'))('billing.title') };
}

export default async function BillingPage() {
  await connection();
  return <BillingDesk scenarios={buildBillingScenarios(await readSeed())} />;
}
