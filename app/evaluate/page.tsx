import type { Metadata } from 'next';
import { connection } from 'next/server';
import { getTranslations } from 'next-intl/server';
import { readSeedDisputePayment, readSeedSubscription } from '@/lib/demo-seed';
import { loadCatalog, withDefaultModels } from '@/lib/settings/catalog';
import { loadSettings } from '@/lib/settings/settings';
import { Evaluator } from './evaluator';

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations('evaluate'))('title') };
}

export default async function EvaluatePage() {
  await connection();
  const [{ ai: chosen }, catalog, subscription, disputePayment] = await Promise.all([
    loadSettings(),
    loadCatalog(),
    readSeedSubscription(),
    readSeedDisputePayment(),
  ]);
  const ai = await withDefaultModels(chosen, async () => catalog);
  const provider = catalog.providers.find((p) => p.id === ai.provider)?.label ?? (await getTranslations('evaluate'))('customProvider');
  return <Evaluator model={ai.agentModel} provider={provider} subscription={Boolean(subscription)} dispute={Boolean(disputePayment?.captureId)} />;
}
