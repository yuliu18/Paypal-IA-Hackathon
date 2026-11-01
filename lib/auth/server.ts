// Neon Auth for Server Components and Route Handlers (sign in, create the owner, sign out, read the
// session). Created on first use and only when Neon Auth is configured (lib/auth/config.ts).

import { createNeonAuth } from '@neon/auth/next/server';
import { createAuthServer } from '@neon/auth/server';
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

// After a password reset: ends every session of the account, wherever it was signed in. Neon Auth
// only revokes sessions for a signed-in caller, so this signs in with the new password in a
// throwaway cookie jar (nothing reaches the browser), revokes the other sessions, then signs that
// one out too. A browser that cached its session keeps it until the cache expires (5 minutes).
export async function signOutEverywhere({ email, password, origin }: { email: string; password: string; origin: string }): Promise<void> {
  const mode = authMode();
  if (mode.kind !== 'neon') throw new Error('Neon Auth is not configured');
  const jar = new Map<string, string>();
  const server = createAuthServer({
    baseUrl: mode.baseUrl,
    cookieSecret: mode.cookieSecret,
    context: () => ({
      getCookies: () => [...jar].map(([name, value]) => `${name}=${value}`).join('; '),
      setCookie: (name, value, options) => {
        if (!value || options?.maxAge === 0) jar.delete(name);
        else jar.set(name, value);
      },
      getHeader: () => null,
      getOrigin: () => origin,
      getFramework: () => 'nextjs',
    }),
  });
  const signedIn = await server.signIn.email({ email, password });
  if (signedIn.error) throw new Error(`Sign-in to revoke sessions failed (${signedIn.error.status ?? 'no status'})`);
  const revoked = await server.revokeOtherSessions();
  await server.signOut();
  if (revoked.error) throw new Error(`Revoking the other sessions failed (${revoked.error.status ?? 'no status'})`);
}
