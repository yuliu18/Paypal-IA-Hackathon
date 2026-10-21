// The demo's sample payments: three captured sandbox card payments whose orders the support
// tickets refer to. Created by `npm run seed` or the button on /support; sandbox money is fictitious.

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

// Charges every purchase, then replaces the file in one rename, so a failed charge keeps the
// previous payments.
export async function seedSandbox(charge: (purchase: Purchase) => Promise<Charge> = chargeCard, file = SEED_FILE): Promise<SeedCharge[]> {
  const charges: SeedCharge[] = [];
  for (const purchase of PURCHASES) charges.push({ ...purchase, ...(await charge(purchase)) });
  await mkdir(dirname(file), { recursive: true });
  const partial = `${file}.${process.pid}.tmp`;
  await writeFile(partial, `${JSON.stringify({ createdAt: new Date().toISOString(), charges }, null, 2)}\n`);
  await rename(partial, file);
  return charges;
}

// The current sample payments; none when they were never created or the file can't be read.
export async function readSeed(file = SEED_FILE): Promise<SeedCharge[]> {
  try {
    return (JSON.parse(await readFile(file, 'utf8')) as { charges: SeedCharge[] }).charges;
  } catch {
    return [];
  }
}
