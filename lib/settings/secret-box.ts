// Encrypts the API keys the shop owner saves on the settings page, so data/settings.json never
// holds them in plain text. AES-256-GCM with a key derived from SETTINGS_SECRET: a wrong secret or
// an edited file fails authentication instead of decrypting to garbage. Server-side only.

import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'node:crypto';

const PREFIX = 'v1.';
const IV_BYTES = 12;
const TAG_BYTES = 16;

// scrypt is deliberately slow, so the derived key is kept for the last secret used.
let derived: { secret: string; key: Buffer } | undefined;

function keyFor(secret: string): Buffer {
  if (derived?.secret !== secret) derived = { secret, key: scryptSync(secret, 'payment-guard/settings/v1', 32) };
  return derived.key;
}

export function sealSecret(plain: string, secret: string): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv('aes-256-gcm', keyFor(secret), iv);
  const encrypted = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return PREFIX + Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString('base64url');
}

// The plain key, or undefined when the text was not sealed with this secret or was altered.
export function openSecret(sealed: string, secret: string): string | undefined {
  if (!sealed.startsWith(PREFIX)) return undefined;
  const bytes = Buffer.from(sealed.slice(PREFIX.length), 'base64url');
  if (bytes.length < IV_BYTES + TAG_BYTES) return undefined;
  try {
    const decipher = createDecipheriv('aes-256-gcm', keyFor(secret), bytes.subarray(0, IV_BYTES));
    decipher.setAuthTag(bytes.subarray(IV_BYTES, IV_BYTES + TAG_BYTES));
    return Buffer.concat([decipher.update(bytes.subarray(IV_BYTES + TAG_BYTES)), decipher.final()]).toString('utf8');
  } catch {
    return undefined;
  }
}
