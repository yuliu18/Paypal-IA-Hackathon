// Seeds the PayPal sandbox with captured payments for the demo support tickets and writes their
// capture ids to data/seed.json. Each run charges new payments; sandbox money is fictitious.
// Run with: npm run seed

import { mkdirSync, writeFileSync } from 'node:fs';
import { chargeCard, type Money } from '../lib/paypal.ts';

type Purchase = { customerEmail: string; description: string; amount: Money };

const PURCHASES: Purchase[] = [
  { customerEmail: 'ana@example.com', description: 'Ceramic mug set', amount: { value: '49.99', currency_code: 'USD' } },
  { customerEmail: 'ben@example.com', description: 'Linen tablecloth', amount: { value: '120.00', currency_code: 'USD' } },
  { customerEmail: 'carla@example.com', description: 'Espresso cups (x6)', amount: { value: '35.50', currency_code: 'USD' } },
];

const OUTPUT = 'data/seed.json';

const charges = [];
for (const purchase of PURCHASES) {
  const charge = await chargeCard(purchase);
  console.log(`${purchase.customerEmail.padEnd(20)} ${purchase.amount.value.padStart(7)} ${purchase.amount.currency_code}  capture ${charge.captureId}`);
  charges.push({ ...purchase, ...charge });
}

mkdirSync('data', { recursive: true });
writeFileSync(OUTPUT, `${JSON.stringify({ createdAt: new Date().toISOString(), charges }, null, 2)}\n`);
console.log(`Wrote ${charges.length} captured payments to ${OUTPUT}`);
