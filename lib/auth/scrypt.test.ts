import { scryptSync } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { hashPassword, spendPasswordCheck, verifyPassword } from './scrypt';

describe('owner password hashing', () => {
  it('stores scrypt$N$r$p$salt$hash with N=2^15, r=8, p=1, a random 16-byte salt and a 64-byte key', async () => {
    const stored = await hashPassword('Correct-horse-1');
    const [scheme, n, r, p, salt, hash] = stored.split('$');
    expect([scheme, n, r, p]).toEqual(['scrypt', '32768', '8', '1']);
    expect(Buffer.from(salt, 'base64')).toHaveLength(16);
    expect(Buffer.from(hash, 'base64')).toHaveLength(64);
    expect(Buffer.from(hash, 'base64').equals(scryptSync('Correct-horse-1', Buffer.from(salt, 'base64'), 64, { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 }))).toBe(true);
    expect(stored).not.toContain('Correct-horse-1');
    expect(await hashPassword('Correct-horse-1')).not.toBe(stored);
  });

  it('accepts the right password and refuses a wrong one', async () => {
    const stored = await hashPassword('Correct-horse-1');
    expect(await verifyPassword('Correct-horse-1', stored)).toBe(true);
    expect(await verifyPassword('Correct-horse-2', stored)).toBe(false);
    expect(await verifyPassword('', stored)).toBe(false);
  });

  it('refuses, without throwing, a stored hash that is malformed or asks for unreasonable work', async () => {
    const stored = await hashPassword('Correct-horse-1');
    const [, , , , salt, hash] = stored.split('$');
    for (const bad of ['', 'plain-text', `bcrypt$32768$8$1$${salt}$${hash}`, `scrypt$32768$8$1$${salt}`, `scrypt$1000$8$1$${salt}$${hash}`, `scrypt$${2 ** 24}$8$1$${salt}$${hash}`, `scrypt$32768$8$1$${salt}$${hash.slice(0, 20)}`, `scrypt$32768$8$1$$${hash}`]) {
      expect(await verifyPassword('Correct-horse-1', bad)).toBe(false);
    }
  });

  it('spends one scrypt for an unknown account, so its answer takes as long as a real check', async () => {
    const start = performance.now();
    await verifyPassword('Correct-horse-1', await hashPassword('Other-password-1'));
    const real = performance.now() - start;
    const spentStart = performance.now();
    await spendPasswordCheck('Correct-horse-1');
    await spendPasswordCheck('Correct-horse-1');
    const spent = (performance.now() - spentStart) / 2;
    // `real` is two scrypts (hashing the stored password, then checking): one spent check is about
    // half of it; a factor of 8 keeps a busy test machine from failing it.
    expect(await spendPasswordCheck('x')).toBe(false);
    expect(spent).toBeGreaterThan(real / 8);
  });
});
