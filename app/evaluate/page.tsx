import type { Metadata } from 'next';
import { connection } from 'next/server';
import { readSeedDisputePayment, readSeedSubscription } from '@/lib/demo-seed';
import { loadCatalog, withDefaultModels } from '@/lib/settings/catalog';
import { loadSettings } from '@/lib/settings/settings';
import { Evaluator } from './evaluator';

export const metadata: Metadata = { title: 'Evaluate model' };

export default async function EvaluatePage() {
  await connection();
  const [{ ai: chosen }, catalog, subscription, disputePayment] = await Promise.all([
    loadSettings(),
    loadCatalog(),
    readSeedSubscription(),
    readSeedDisputePayment(),
  ]);
  const ai = await withDefaultModels(chosen, async () => catalog);
  const provider = catalog.providers.find((p) => p.id === ai.provider)?.label ?? 'a custom provider';
  return <Evaluator model={ai.agentModel} provider={provider} subscription={Boolean(subscription)} dispute={Boolean(disputePayment?.captureId)} />;
}
