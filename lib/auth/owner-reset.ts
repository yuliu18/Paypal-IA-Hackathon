// Recovery for the built-in owner account (npm run owner:reset, scripts/owner-reset.mts): whoever
// can run commands on the server sets a new random password, which meets the password rule, and
// every session ends. There is no email recovery without Neon Auth. Relative imports carry .ts so
// plain Node can load this file.

import { randomBytes } from 'node:crypto';
import type { LocalAuthStore } from './local-store.ts';
import { passwordProblems } from './password.ts';
import { hashPassword } from './scrypt.ts';

export type OwnerReset = { kind: 'reset'; email: string; password: string } | { kind: 'no-owner' };

// 24 characters from 18 random bytes (144 bits), drawn again in the rare case one class is missing.
export function randomStrongPassword(): string {
  for (;;) {
    const password = randomBytes(18).toString('base64url');
    if (passwordProblems(password).length === 0) return password;
  }
}

export async function resetLocalOwnerPassword(store: LocalAuthStore, now: Date = new Date()): Promise<OwnerReset> {
  const owner = await store.owner();
  if (owner === null) return { kind: 'no-owner' };
  const password = randomStrongPassword();
  // The owner can only disappear between the two calls if someone deletes the row by hand.
  if (!(await store.setPassword(await hashPassword(password), now))) return { kind: 'no-owner' };
  return { kind: 'reset', email: owner.email, password };
}
