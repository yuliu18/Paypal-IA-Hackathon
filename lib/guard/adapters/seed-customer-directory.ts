// CustomerDirectory backed by the demo's sample payments (lib/demo-seed.ts): the shop's customers
// are the people it charged (ana, ben and carla once seeded). The buyer of the sample PayPal
// payment and the subscriber are sandbox accounts, not shop customers. A real shop would ask its
// own customer records instead.

import { readSeed, SEED_FILE } from '@/lib/demo-seed';
import type { CustomerDirectory } from '../ports';

const normalized = (email: string) => email.trim().toLowerCase();

export function createSeedCustomerDirectory(file = SEED_FILE): CustomerDirectory {
  return {
    async isCustomer(email) {
      if (!normalized(email)) return false;
      const charges = await readSeed(file);
      return charges.some((charge) => typeof charge.customerEmail === 'string' && normalized(charge.customerEmail) === normalized(email));
    },
  };
}

export const seedCustomerDirectory = createSeedCustomerDirectory();
