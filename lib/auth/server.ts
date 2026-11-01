// Neon Auth for Server Components and Route Handlers (sign in, create the owner, sign out, read the
// session). Created on first use and only when Neon Auth is configured (lib/auth/config.ts).

import { createNeonAuth } from '@neon/auth/next/server';
import { authMode } from './config';

type NeonAuth = ReturnType<typeof createNeonAuth>;

const globalForAuth = globalThis as typeof globalThis & { neonAuth?: NeonAuth };

export function neonAuth(): NeonAuth {
  const mode = authMode();
  if (mode.kind !== 'neon') throw new Error('Neon Auth is not configured');
  globalForAuth.neonAuth ??= createNeonAuth({ baseUrl: mode.baseUrl, cookies: { secret: mode.cookieSecret } });
  return globalForAuth.neonAuth;
}

// The signed-in user's id, or undefined.
export async function sessionUserId(): Promise<string | undefined> {
  const { data } = await neonAuth().getSession();
  return data?.user?.id ?? undefined;
}
