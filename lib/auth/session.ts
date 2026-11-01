// Reads the signed-in user from a request inside proxy.ts, with Neon Auth's own server toolkit: the
// signed session cache cookie when it is valid, otherwise Neon Auth itself. Cookies Neon Auth
// refreshes on the way are collected so the gate can pass them on.

import { createAuthServer, extractNeonAuthCookies } from '@neon/auth/server';
import type { NextRequest } from 'next/server';
import type { SessionCookie, SessionRead } from './gate';

export async function readSession(request: NextRequest, { baseUrl, cookieSecret }: { baseUrl: string; cookieSecret: string }): Promise<SessionRead> {
  const cookies: SessionCookie[] = [];
  const server = createAuthServer({
    baseUrl,
    cookieSecret,
    context: () => ({
      getCookies: () => extractNeonAuthCookies(request.headers),
      setCookie: (name, value, options) => {
        cookies.push({ name, value, options });
      },
      getHeader: (name) => request.headers.get(name),
      getOrigin: () => request.nextUrl.origin,
      getFramework: () => 'nextjs',
    }),
  });
  const { data, error } = await server.getSession();
  // A Neon Auth error is not "signed out": it is unknown, and the gate fails closed on a throw.
  if (error && (error.status ?? 500) >= 500) throw new Error(`Neon Auth session check failed (${error.status ?? 'no status'})`);
  return { userId: data?.user?.id ?? undefined, cookies };
}
