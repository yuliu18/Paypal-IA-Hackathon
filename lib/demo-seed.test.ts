import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readSeed, readSeedDisputePayment, readSeedSubscription, saveSeedDisputePayment, saveSeedSubscription, seedSandbox } from './demo-seed';

let dir: string;
let file: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'demo-seed-'));
  file = join(dir, 'data', 'seed.json');
});
afterEach(() => rm(dir, { recursive: true, force: true }));

let next = 0;
const fakeCharge = async () => {
  next += 1;
  return { orderId: `ORDER-${next}`, captureId: `CAP-${next}`, status: 'COMPLETED' };
};

describe('seedSandbox', () => {
  it('charges the three demo purchases in order and writes them for the support page', async () => {
    next = 0;
    const charges = await seedSandbox(fakeCharge, file);
    expect(charges.map((c) => [c.customerEmail, c.amount.value, c.orderId])).toEqual([
      ['ana@example.com', '49.99', 'ORDER-1'],
      ['ben@example.com', '120.00', 'ORDER-2'],
      ['carla@example.com', '35.50', 'ORDER-3'],
    ]);
    const saved = JSON.parse(await readFile(file, 'utf8'));
    expect(saved.charges).toEqual(charges);
    expect(typeof saved.createdAt).toBe('string');
    expect(await readSeed(file)).toEqual(charges);
  });

  it('keeps the previous payments when a charge fails', async () => {
    next = 0;
    const before = await seedSandbox(fakeCharge, file);
    let calls = 0;
    const failing = async () => {
      calls += 1;
      if (calls === 2) throw new Error('PayPal down');
      return fakeCharge();
    };
    await expect(seedSandbox(failing, file)).rejects.toThrow('PayPal down');
    expect(await readSeed(file)).toEqual(before);
  });
});

describe('readSeed', () => {
  it('returns no payments when the seed was never run or the file is unreadable', async () => {
    expect(await readSeed(file)).toEqual([]);
    await seedSandbox(fakeCharge, file);
    await writeFile(file, 'not json');
    expect(await readSeed(file)).toEqual([]);
  });
});

describe('seed subscription', () => {
  it('keeps the sample subscription when new sample payments are charged', async () => {
    next = 0;
    await saveSeedSubscription({ id: 'I-SUB1', approveUrl: 'https://approve', createdAt: '2026-10-23T00:00:00.000Z' }, file);
    const charges = await seedSandbox(fakeCharge, file);
    expect(await readSeed(file)).toEqual(charges);
    expect(await readSeedSubscription(file)).toEqual({ id: 'I-SUB1', approveUrl: 'https://approve', createdAt: '2026-10-23T00:00:00.000Z' });
  });

  it('reads no subscription from a seed that has none or an unreadable one', async () => {
    expect(await readSeedSubscription(file)).toBeUndefined();
    await seedSandbox(fakeCharge, file);
    expect(await readSeedSubscription(file)).toBeUndefined();
    await writeFile(file, JSON.stringify({ charges: [], subscription: { id: 42 } }));
    expect(await readSeedSubscription(file)).toBeUndefined();
  });
});

describe('seed PayPal payment', () => {
  it('keeps the sample PayPal payment next to the subscription when new sample payments are charged', async () => {
    next = 0;
    const payment = { orderId: 'O-1', approveUrl: 'https://approve', createdAt: '2026-10-24T00:00:00.000Z', captureId: 'CAP-9', customerEmail: 'buyer@example.com' };
    await saveSeedSubscription({ id: 'I-SUB1', approveUrl: 'https://approve', createdAt: '2026-10-23T00:00:00.000Z' }, file);
    await saveSeedDisputePayment(payment, file);
    await seedSandbox(fakeCharge, file);
    expect(await readSeedDisputePayment(file)).toEqual(payment);
    expect((await readSeedSubscription(file))?.id).toBe('I-SUB1');
  });

  it('reads no PayPal payment from a seed that has none or an unreadable one', async () => {
    expect(await readSeedDisputePayment(file)).toBeUndefined();
    await saveSeedDisputePayment({ orderId: 'O-1', approveUrl: 'https://approve', createdAt: '' }, file);
    await writeFile(file, JSON.stringify({ disputePayment: { orderId: 42 } }));
    expect(await readSeedDisputePayment(file)).toBeUndefined();
  });
});
