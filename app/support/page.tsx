import type { Metadata } from 'next';
import { connection } from 'next/server';
import { findSampleDispute } from '@/lib/demo-dispute-payment';
import { readSeed, readSeedDisputePayment, readSeedSubscription, type SeedDisputePayment } from '@/lib/demo-seed';
import { payPalSubscriptionLookup } from '@/lib/guard/adapters/paypal-subscription-lookup';
import type { SubscriptionFacts } from '@/lib/guard/domain/cancellation';
import type { DisputePaymentStep } from './dispute-payment-button';
import { buildScenarios, pendingApproval, type SampleDisputeTicket } from './scenarios';
import { SupportDesk } from './support-desk';

export const metadata: Metadata = { title: 'Support agent demo' };

// The sample subscription as PayPal reports it now: its owner is whoever approved it. Undefined
// when there is none or PayPal can't be reached, which leaves its tickets out.
async function sampleSubscription(id: string | undefined): Promise<SubscriptionFacts | undefined> {
  if (!id) return undefined;
  try {
    return await payPalSubscriptionLookup.getSubscription(id);
  } catch (error) {
    console.error('Sample subscription could not be read', error);
    return undefined;
  }
}

// The dispute the buyer opened on the sample PayPal payment, once it is paid. Undefined when there
// is none yet or PayPal can't be reached, which leaves its tickets out.
async function sampleDispute(payment: SeedDisputePayment | undefined): Promise<SampleDisputeTicket | undefined> {
  if (!payment?.captureId || !payment.customerEmail) return undefined;
  try {
    const dispute = await findSampleDispute(payment.captureId);
    return dispute && { ...dispute, customerEmail: payment.customerEmail };
  } catch (error) {
    console.error('Sample dispute could not be read', error);
    return undefined;
  }
}

function disputePaymentStep(payment: SeedDisputePayment | undefined, dispute: SampleDisputeTicket | undefined): DisputePaymentStep {
  if (!payment) return { step: 'none' };
  if (!payment.captureId) return { step: 'unpaid', approveUrl: payment.approveUrl };
  return dispute ? { step: 'disputed', disputeId: dispute.id, status: dispute.status } : { step: 'paid' };
}

export default async function SupportPage() {
  await connection();
  const [charges, seedSubscription, disputePayment] = await Promise.all([readSeed(), readSeedSubscription(), readSeedDisputePayment()]);
  const [subscription, dispute] = await Promise.all([sampleSubscription(seedSubscription?.id), sampleDispute(disputePayment)]);
  return (
    <SupportDesk
      scenarios={buildScenarios(charges, subscription, dispute)}
      pendingApproveUrl={pendingApproval(seedSubscription, subscription)}
      disputePayment={disputePaymentStep(disputePayment, dispute)}
    />
  );
}
