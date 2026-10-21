// Seeds the PayPal sandbox with captured payments for the demo support tickets and writes their
// capture ids to data/seed.json. Each run charges new payments; sandbox money is fictitious.
// The "New sample payments" button on /support does the same on a deployed app.
// Run with: npm run seed

import { SEED_FILE, seedSandbox } from '../lib/demo-seed.ts';

const charges = await seedSandbox();
for (const charge of charges) {
  console.log(`${charge.customerEmail.padEnd(20)} ${charge.amount.value.padStart(7)} ${charge.amount.currency_code}  capture ${charge.captureId}`);
}
console.log(`Wrote ${charges.length} captured payments to ${SEED_FILE}`);
