// Sessions of the built-in owner account (lib/auth/config.ts `local` mode), kept on the server: the
// cookie `pg_session` holds 32 random bytes in base64url, and the store keeps only their SHA-256
// with an expiry, 7 days on. The cookie is HttpOnly, SameSite=Lax, Path=/, and Secure whenever the
// request came over https (directly or, behind the host's proxy, by x-forwarded-proto).

import { createHash, randomBytes } from 'node:crypto';
import type { NextRequest } from 'next/server';
import type { SessionCookie, SessionRead } from './gate';
import type { LocalAuthStore } from './local-store';

export const SESSION_COOKIE = 'pg_session';
export const SESSION_MAX_AGE_SECONDS = 7 * 24 * 60 * 60;
// The only id a local session can carry: there is one owner.
export const LOCAL_OWNER_ID = 'owner';

const TOKEN_FORMAT = /^[A-Za-z0-9_-]{43}$/;

const tokenHash = (token: string) => createHash('sha256').update(token).digest('hex');

// The session cookie's token when it is well formed, otherwise undefined (nothing to look up).
function cookieToken(request: NextRequest): string | undefined {
  const token = request.cookies.get(SESSION_COOKIE)?.value;
  return token && TOKEN_FORMAT.test(token) ? token : undefined;
}

export function isHttps(request: NextRequest): boolean {
  const forwarded = request.headers.get('x-forwarded-proto')?.split(',')[0]?.trim().toLowerCase();
  return forwarded ? forwarded === 'https' : request.nextUrl.protocol === 'https:';
}

// Starts a session and returns its token, for the cookie only: it is never stored.
export async function startSession(store: LocalAuthStore, now: Date = new Date()): Promise<string> {
  const token = randomBytes(32).toString('base64url');
  await store.createSession(tokenHash(token), new Date(now.getTime() + SESSION_MAX_AGE_SECONDS * 1000), now);
  return token;
}

export function sessionCookie(request: NextRequest, token: string): SessionCookie {
  return { name: SESSION_COOKIE, value: token, options: { httpOnly: true, sameSite: 'lax', path: '/', secure: isHttps(request), maxAge: SESSION_MAX_AGE_SECONDS } };
}

export function clearedSessionCookie(request: NextRequest): SessionCookie {
  return { name: SESSION_COOKIE, value: '', options: { httpOnly: true, sameSite: 'lax', path: '/', secure: isHttps(request), maxAge: 0 } };
}

// Ends the request's session, when it has one. Errors propagate.
export async function endSession(store: LocalAuthStore, request: NextRequest): Promise<void> {
  const token = cookieToken(request);
  if (token !== undefined) await store.deleteSession(tokenHash(token));
}

// What the gate (lib/auth/gate.ts) asks for in local mode. A live session means the owner's: it is
// checked against an existing owner, and a password reset ends every session. `store` is called
// inside the check, so a store that can't even be opened fails closed like one that can't be read.
export function localSession(store: () => LocalAuthStore, now: () => Date = () => new Date()): { session(request: NextRequest): Promise<SessionRead>; ownerId(): Promise<string | null> } {
  return {
    async session(request) {
      const token = cookieToken(request);
      if (token === undefined) return { userId: undefined, cookies: [] };
      return { userId: (await store().hasSession(tokenHash(token), now())) ? LOCAL_OWNER_ID : undefined, cookies: [] };
    },
    ownerId: async () => LOCAL_OWNER_ID,
  };
}
