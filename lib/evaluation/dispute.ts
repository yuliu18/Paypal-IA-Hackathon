// The sample dispute as the evaluation needs it (lib/evaluation/evaluation.ts): the newest dispute
// the buyer opened on the paid sample PayPal payment, its status from PayPal and its buyer from the
// seed file (PayPal hides the buyer's email from the shop). Without one the run has no dispute cases.

import { findSampleDispute, type SampleDispute } from '@/lib/demo-dispute-payment';
import { readSeedDisputePayment, type SeedDisputePayment } from '@/lib/demo-seed';
import type { EvalDispute } from './evaluation';

export async function evaluationDispute({
  read = readSeedDisputePayment,
  find = findSampleDispute,
}: { read?: () => Promise<SeedDisputePayment | undefined>; find?: (captureId: string) => Promise<SampleDispute | undefined> } = {}): Promise<EvalDispute | undefined> {
  // Never fails the run: without a readable dispute the run has no dispute cases.
  try {
    const payment = await read();
    if (!payment?.captureId) return undefined;
    const dispute = await find(payment.captureId);
    return dispute && { id: dispute.id, status: dispute.status, customerEmail: payment.customerEmail ?? null };
  } catch (error) {
    console.error('Evaluation could not look up the sample dispute', error);
    return undefined;
  }
}
