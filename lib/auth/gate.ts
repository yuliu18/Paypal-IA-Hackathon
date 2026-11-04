// The decision proxy.ts makes for every page and API route (static assets never reach it).
// Only the owner's session opens the app, whether Neon Auth keeps the account or the app does
// (lib/auth/local-session.ts); pages without it go to /login, API calls get 401. Anything that
// cannot be checked (Neon Auth, the database or the account file unreachable) counts as no
// session: it fails closed.
// In either mode, the three agent routes also take `Authorization: Bearer <api key>` (the
// business's own app); a key that doesn't check out is refused with 401, and no other route looks
// at it. Every request let through loses any x-pg-auth header the client sent; the proxy sets it
// only for a key it checked (./api-key-header.ts).

import { NextResponse, type NextRequest } from 'next/server';
import { acceptsApiKey, bearerToken, isPublicRequest, neonAccess } from './access';
import { API_KEY_AUTH_HEADER, apiKeyAuthValue } from './api-key-header';
import type { AuthMode } from './config';

export type SessionCookie = { name: string; value: string; options: { maxAge?: number; expires?: Date; path?: string; domain?: string; secure?: boolean; httpOnly?: boolean; sameSite?: 'strict' | 'lax' | 'none'; partitioned?: boolean } };
export type SessionRead = { userId: string | undefined; cookies: SessionCookie[] };

export type GateDeps = {
  mode: AuthMode;
  session: (request: NextRequest) => Promise<SessionRead>;
  ownerId: () => Promise<string | null>;
  // The key's id when it is a live API key, otherwise null.
  apiKey: (key: string) => Promise<{ keyId: string } | null>;
};

const isApi = (pathname: string) => pathname === '/api' || pathname.startsWith('/api/');

// Lets the request through with the client's x-pg-auth removed, and the proxy's own when given.
function pass(request: NextRequest, apiKeyId?: string): NextResponse {
  const headers = new Headers(request.headers);
  headers.delete(API_KEY_AUTH_HEADER);
  if (apiKeyId !== undefined) headers.set(API_KEY_AUTH_HEADER, apiKeyAuthValue(apiKeyId));
  return NextResponse.next({ request: { headers } });
}

async function keyHolder(key: string, deps: GateDeps): Promise<string | undefined> {
  try {
    return (await deps.apiKey(key))?.keyId;
  } catch (error) {
    console.error('API key check failed; refusing the key', error);
    return undefined;
  }
}

export async function gate(request: NextRequest, deps: GateDeps): Promise<NextResponse> {
  const { mode } = deps;
  if (mode.kind === 'misconfigured') return new NextResponse(`Sign-in is not configured: set ${mode.missing.join(', ')}.`, { status: 503 });

  const { pathname, search } = request.nextUrl;
  const serverAction = request.headers.has('next-action');
  const key = bearerToken(request.headers.get('authorization'));
  if (key !== undefined && acceptsApiKey({ method: request.method, pathname, serverAction })) {
    const keyId = await keyHolder(key, deps);
    return keyId === undefined ? NextResponse.json({ error: 'Invalid or revoked API key.' }, { status: 401 }) : pass(request, keyId);
  }

  if (isPublicRequest({ method: request.method, pathname, serverAction })) return pass(request);

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
    const response = pass(request);
    for (const { name, value, options } of read.cookies) response.cookies.set(name, value, options);
    return response;
  }
  if (isApi(pathname)) return NextResponse.json({ error: 'Sign in required.' }, { status: 401 });
  // Absolute here, unlike the route handlers' relative redirects (lib/http/redirect.ts): Next's
  // proxy adapter parses a proxy's Location with new URL() and throws on a bare path, then turns a
  // same-host one back into a relative path itself, so the internal host never reaches the browser.
  const login = new URL('/login', request.url);
  const next = `${pathname}${search}`;
  if (next !== '/') login.searchParams.set('next', next);
  return NextResponse.redirect(login);
}
