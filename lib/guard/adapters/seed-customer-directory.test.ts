import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createSeedCustomerDirectory } from './seed-customer-directory';

const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function seedFile(content: string) {
  const dir = await mkdtemp(join(tmpdir(), 'customers-'));
  dirs.push(dir);
  const file = join(dir, 'seed.json');
  await writeFile(file, content);
  return file;
}

const charge = (customerEmail: string) => ({ customerEmail, description: 'x', amount: { value: '1.00', currency_code: 'USD' }, orderId: 'O', captureId: 'C' });

describe('seed customer directory', () => {
  it('knows the customers of the sample payments, whatever the case of their email', async () => {
    const directory = createSeedCustomerDirectory(await seedFile(JSON.stringify({ charges: [charge('ana@example.com'), charge('Ben@Example.com')] })));
    expect(await directory.isCustomer('ana@example.com')).toBe(true);
    expect(await directory.isCustomer(' ben@example.com ')).toBe(true);
    expect(await directory.isCustomer('mallory@example.com')).toBe(false);
    expect(await directory.isCustomer('')).toBe(false);
  });

  it('knows no one before the sample payments exist', async () => {
    const directory = createSeedCustomerDirectory(join(tmpdir(), 'no-such-dir', 'seed.json'));
    expect(await directory.isCustomer('ana@example.com')).toBe(false);
  });

  it('ignores the buyer of the sample PayPal payment, who is not one of the shop customers', async () => {
    const directory = createSeedCustomerDirectory(await seedFile(JSON.stringify({ charges: [charge('ana@example.com')], disputePayment: { orderId: 'O', approveUrl: 'u', createdAt: '', customerEmail: 'buyer@example.com' } })));
    expect(await directory.isCustomer('buyer@example.com')).toBe(false);
  });
});
