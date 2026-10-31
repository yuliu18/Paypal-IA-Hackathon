// The demo's sample payments: three captured sandbox card payments whose orders the support
// tickets refer to, plus the sample subscription and the sample PayPal payment once they are created. Created by `npm run seed` or the button on /support; sandbox money is fictitious.

import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { chargeCard, type Charge, type Money } from './paypal.ts';
import { priceValueOf } from './shop/catalogue.ts';

type Purchase = { customerEmail: string; description: string; amount: Money };
export type SeedCharge = Purchase & Charge;

// Each customer bought one catalogue product at its catalogue price.
const purchase = (customerEmail: string, product: string): Purchase => ({ customerEmail, description: product, amount: { value: priceValueOf(product), currency_code: 'USD' } });
const PURCHASES: Purchase[] = [
  purchase('ana@example.com', 'Ceramic mug set'),
  purchase('ben@example.com', 'Linen tablecloth'),
  purchase('carla@example.com', 'Espresso cups (x6)'),
];

export const SEED_FILE = 'data/seed.json';

// The sample subscription (lib/demo-subscription.ts): a sandbox buyer approves it once through its
// approval link, and then owns it.
export type SeedSubscription = { id: string; approveUrl: string; createdAt: string };

// The sample PayPal-account payment (lib/demo-dispute-payment.ts) a sandbox buyer pays and can then
// dispute. `captureId` and `customerEmail` are set once the buyer paid and the shop captured it.
export type SeedDisputePayment = { orderId: string; approveUrl: string; createdAt: string; captureId?: string; customerEmail?: string };

type SeedFile = { createdAt?: string; charges?: SeedCharge[]; subscription?: SeedSubscription; disputePayment?: SeedDisputePayment };

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

// Everything in the seed file; empty when it was never written or can't be read.
async function readSeedFile(file: string): Promise<SeedFile> {
  try {
    const parsed: unknown = JSON.parse(await readFile(file, 'utf8'));
    return isRecord(parsed) ? (parsed as SeedFile) : {};
  } catch {
    return {};
  }
}

// Replaces the file in one rename, so a reader never sees half of it.
async function writeSeedFile(file: string, seed: SeedFile): Promise<void> {
  await mkdir(dirname(file), { recursive: true });
  const partial = `${file}.${process.pid}.tmp`;
  await writeFile(partial, `${JSON.stringify(seed, null, 2)}\n`);
  await rename(partial, file);
}

// Charges every purchase at the same time (each sandbox charge takes seconds), then writes them all
// at once, so a failed charge keeps the previous payments. The sample subscription and PayPal
// payment, if any, are kept.
export async function seedSandbox(charge: (purchase: Purchase) => Promise<Charge> = chargeCard, file = SEED_FILE): Promise<SeedCharge[]> {
  const charges: SeedCharge[] = await Promise.all(PURCHASES.map(async (purchase) => ({ ...purchase, ...(await charge(purchase)) })));
  const { subscription, disputePayment } = await readSeedFile(file);
  await writeSeedFile(file, { createdAt: new Date().toISOString(), charges, ...(subscription && { subscription }), ...(disputePayment && { disputePayment }) });
  return charges;
}

// Records the sample subscription next to the sample payments, keeping them.
export async function saveSeedSubscription(subscription: SeedSubscription, file = SEED_FILE): Promise<void> {
  await writeSeedFile(file, { ...(await readSeedFile(file)), subscription });
}

// Records the sample PayPal payment next to the other sample data, keeping it.
export async function saveSeedDisputePayment(disputePayment: SeedDisputePayment, file = SEED_FILE): Promise<void> {
  await writeSeedFile(file, { ...(await readSeedFile(file)), disputePayment });
}

// The current sample payments; none when they were never created or the file can't be read.
export async function readSeed(file = SEED_FILE): Promise<SeedCharge[]> {
  const { charges } = await readSeedFile(file);
  return Array.isArray(charges) ? charges : [];
}

// The sample subscription; none when it was never created or the file can't be read.
export async function readSeedSubscription(file = SEED_FILE): Promise<SeedSubscription | undefined> {
  const { subscription } = await readSeedFile(file);
  if (!isRecord(subscription) || typeof subscription.id !== 'string' || typeof subscription.approveUrl !== 'string') return undefined;
  return { id: subscription.id, approveUrl: subscription.approveUrl, createdAt: String(subscription.createdAt ?? '') };
}

// The sample PayPal payment; none when it was never created or the file can't be read.
export async function readSeedDisputePayment(file = SEED_FILE): Promise<SeedDisputePayment | undefined> {
  const { disputePayment: p } = await readSeedFile(file);
  if (!isRecord(p) || typeof p.orderId !== 'string' || typeof p.approveUrl !== 'string') return undefined;
  return {
    orderId: p.orderId,
    approveUrl: p.approveUrl,
    createdAt: String(p.createdAt ?? ''),
    ...(typeof p.captureId === 'string' && { captureId: p.captureId }),
    ...(typeof p.customerEmail === 'string' && { customerEmail: p.customerEmail }),
  };
}
