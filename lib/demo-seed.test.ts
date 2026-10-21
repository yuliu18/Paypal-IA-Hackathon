import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readSeed, seedSandbox } from './demo-seed';

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
