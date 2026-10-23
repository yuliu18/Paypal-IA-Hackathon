// The demo's sample payments: three captured sandbox card payments whose orders the support
// tickets refer to, plus the sample subscription once one is created. Created by `npm run seed` or the button on /support; sandbox money is fictitious.

import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { chargeCard, type Charge, type Money } from './paypal.ts';

type Purchase = { customerEmail: string; description: string; amount: Money };
export type SeedCharge = Purchase & Charge;

const PURCHASES: Purchase[] = [
  { customerEmail: 'ana@example.com', description: 'Ceramic mug set', amount: { value: '49.99', currency_code: 'USD' } },
  { customerEmail: 'ben@example.com', description: 'Linen tablecloth', amount: { value: '120.00', currency_code: 'USD' } },
  { customerEmail: 'carla@example.com', description: 'Espresso cups (x6)', amount: { value: '35.50', currency_code: 'USD' } },
];

export const SEED_FILE = 'data/seed.json';

// The sample subscription (lib/demo-subscription.ts): a sandbox buyer approves it once through its
// approval link, and then owns it.
export type SeedSubscription = { id: string; approveUrl: string; createdAt: string };

type SeedFile = { createdAt?: string; charges?: SeedCharge[]; subscription?: SeedSubscription };

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

// Charges every purchase, then writes them all at once, so a failed charge keeps the previous
// payments. The sample subscription, if any, is kept.
export async function seedSandbox(charge: (purchase: Purchase) => Promise<Charge> = chargeCard, file = SEED_FILE): Promise<SeedCharge[]> {
  const charges: SeedCharge[] = [];
  for (const purchase of PURCHASES) charges.push({ ...purchase, ...(await charge(purchase)) });
  const { subscription } = await readSeedFile(file);
  await writeSeedFile(file, { createdAt: new Date().toISOString(), charges, ...(subscription && { subscription }) });
  return charges;
}

// Records the sample subscription next to the sample payments, keeping them.
export async function saveSeedSubscription(subscription: SeedSubscription, file = SEED_FILE): Promise<void> {
  await writeSeedFile(file, { ...(await readSeedFile(file)), subscription });
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
