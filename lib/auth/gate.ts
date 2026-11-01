// The decision proxy.ts makes for every page and API route (static assets never reach it).
// With Neon Auth, only the owner's session opens the app; pages without it go to /login, API
// calls get 401. Without Neon Auth, the demo password decides, unchanged. Anything that cannot be
// checked (Neon Auth or the database unreachable) counts as no session: it fails closed.

import { NextResponse, type NextRequest } from 'next/server';
import { isPublicRequest, neonAccess } from './access';
import type { AuthMode } from './config';

export type SessionCookie = { name: string; value: string; options: { maxAge?: number; expires?: Date; path?: string; domain?: string; secure?: boolean; httpOnly?: boolean; sameSite?: 'strict' | 'lax' | 'none'; partitioned?: boolean } };
export type SessionRead = { userId: string | undefined; cookies: SessionCookie[] };

export type GateDeps = {
  mode: AuthMode;
  demo: (request: NextRequest) => NextResponse | Promise<NextResponse>;
  session: (request: NextRequest) => Promise<SessionRead>;
  ownerId: () => Promise<string | null>;
};

const isApi = (pathname: string) => pathname === '/api' || pathname.startsWith('/api/');

export async function gate(request: NextRequest, deps: GateDeps): Promise<NextResponse> {
  const { mode } = deps;
  if (mode.kind === 'demo') return deps.demo(request);
  if (mode.kind === 'misconfigured') return new NextResponse(`Sign-in is not configured: set ${mode.missing.join(', ')}.`, { status: 503 });

  const { pathname, search } = request.nextUrl;
  if (isPublicRequest({ method: request.method, pathname, serverAction: request.headers.has('next-action') })) return NextResponse.next();

  let read: SessionRead = { userId: undefined, cookies: [] };
  let ownerId: string | null = null;
  try {
    read = await deps.session(request);
    if (read.userId !== undefined) ownerId = await deps.ownerId();
  } catch (error) {
    console.error('Sign-in check failed; treating the request as signed out', error);
    read = { userId: undefined, cookies: [] };
  }

  if (neonAccess({ userId: read.userId, ownerId }) === 'allow') {
    const response = NextResponse.next();
    for (const { name, value, options } of read.cookies) response.cookies.set(name, value, options);
    return response;
  }
  if (isApi(pathname)) return NextResponse.json({ error: 'Sign in required.' }, { status: 401 });
  const login = new URL('/login', request.url);
  const next = `${pathname}${search}`;
  if (next !== '/') login.searchParams.set('next', next);
  return NextResponse.redirect(login);
}
