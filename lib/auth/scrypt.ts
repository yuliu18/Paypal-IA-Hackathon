// The built-in owner account's password (lib/auth/config.ts `local` mode), stored only as a scrypt
// hash: `scrypt$N$r$p$<salt base64>$<key base64>`, with a random 16-byte salt, N=2^15, r=8, p=1 and a
// 64-byte key, compared in constant time. Relative imports carry .ts so plain Node (npm run
// owner:reset) can load this file.

import { randomBytes, scrypt, timingSafeEqual, type ScryptOptions } from 'node:crypto';

const N = 2 ** 15;
const R = 8;
const P = 1;
const KEY_LENGTH = 64;
const SALT_LENGTH = 16;
// scrypt needs 128 * N * r bytes (32 MiB here), which is exactly Node's default limit.
const MAX_MEMORY = 64 * 1024 * 1024;

function derive(password: string, salt: Buffer, options: ScryptOptions): Promise<Buffer> {
  return new Promise((resolve, reject) => scrypt(password, salt, KEY_LENGTH, { ...options, maxmem: MAX_MEMORY }, (error, key) => (error ? reject(error) : resolve(key))));
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_LENGTH);
  const key = await derive(password, salt, { N, r: R, p: P });
  return ['scrypt', N, R, P, salt.toString('base64'), key.toString('base64')].join('$');
}

// The stored hash's parts, or undefined when it is not one this file wrote: a tampered or truncated
// value, or parameters that would make one check cost far more than ours.
function parse(stored: string): { options: ScryptOptions; salt: Buffer; key: Buffer } | undefined {
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return undefined;
  const [n, r, p] = parts.slice(1, 4).map((x) => (/^\d{1,8}$/.test(x) ? Number(x) : NaN));
  if (!(n >= 2 ** 14 && n <= 2 ** 17 && (n & (n - 1)) === 0 && r >= 1 && r <= 16 && p >= 1 && p <= 4)) return undefined;
  const salt = Buffer.from(parts[4], 'base64');
  const key = Buffer.from(parts[5], 'base64');
  if (salt.length < SALT_LENGTH || key.length !== KEY_LENGTH) return undefined;
  return { options: { N: n, r, p }, salt, key };
}

// True only for the password the stored hash was made from; false for anything else, a malformed
// stored hash included.
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parsed = parse(stored);
  if (!parsed) return false;
  const key = await derive(password, parsed.salt, parsed.options);
  return timingSafeEqual(key, parsed.key);
}

// A sign-in for an address that is not the owner's does the same work as a real check, so how long
// the answer takes doesn't tell which address is the owner's. Always false.
export async function spendPasswordCheck(password: string): Promise<false> {
  await derive(password, Buffer.alloc(SALT_LENGTH), { N, r: R, p: P });
  return false;
}
