// Shared-password gate for the deployed demo: the app can issue PayPal refunds and spend the LLM
// key, so nobody without the password may reach it. HTTP Basic auth, any user name.
// Without DEMO_PASSWORD it fails closed in production and stays open in local development.

import { createHash, timingSafeEqual } from 'node:crypto';

export type DemoAccess = 'allow' | 'challenge' | 'unconfigured';

// Hashing first gives equal-length buffers, so the comparison takes the same time whatever the guess.
const sameSecret = (a: string, b: string) =>
  timingSafeEqual(createHash('sha256').update(a).digest(), createHash('sha256').update(b).digest());

function basicPassword(authorization: string | null): string | undefined {
  const [scheme, encoded] = authorization?.split(' ') ?? [];
  if (scheme !== 'Basic' || !encoded) return undefined;
  const decoded = Buffer.from(encoded, 'base64').toString('utf8');
  const colon = decoded.indexOf(':');
  return colon === -1 ? undefined : decoded.slice(colon + 1);
}

export function demoAccess({
  authorization,
  password,
  production,
}: {
  authorization: string | null;
  password: string | undefined;
  production: boolean;
}): DemoAccess {
  if (!password) return production ? 'unconfigured' : 'allow';
  const given = basicPassword(authorization);
  return given !== undefined && sameSecret(given, password) ? 'allow' : 'challenge';
}
