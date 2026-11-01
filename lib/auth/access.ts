// What the owner login lets through without a session, and small checks the sign-in endpoints share.

// The login page is read with GET only; signing in, creating the owner and signing out are plain
// form posts to their own endpoints (app/api/auth/*). Server Actions are never public: their ids
// are global, so any public path that accepted them would run any action in the app.
const PUBLIC_PAGES = ['/login'];
const PUBLIC_POSTS = ['/api/auth/sign-in', '/api/auth/owner', '/api/auth/sign-out'];

export function isPublicRequest({ method, pathname, serverAction = false }: { method: string; pathname: string; serverAction?: boolean }): boolean {
  if (serverAction) return false;
  if (method === 'GET' || method === 'HEAD') return PUBLIC_PAGES.includes(pathname);
  if (method === 'POST') return PUBLIC_POSTS.includes(pathname);
  return false;
}

// One owner per installation: only their session opens the app. While nobody has signed up yet,
// everyone is sent to the login page, which then offers to create the owner account.
export function neonAccess({ userId, ownerId }: { userId: string | undefined; ownerId: string | null }): 'allow' | 'sign-in' {
  return userId !== undefined && ownerId !== null && userId === ownerId ? 'allow' : 'sign-in';
}

// Where to go after signing in: a path on this site only, never back to the login or its endpoints.
export function safeNextPath(next: string | null | undefined): string {
  if (!next || !next.startsWith('/') || next.startsWith('//') || next.startsWith('/\\')) return '/';
  // A browser drops tab, CR and LF and reads a backslash as a slash, so "/\t/evil.example" would
  // become "//evil.example", another site: refuse control characters and backslashes anywhere,
  // then check that the path still resolves on this site.
  if (/[\u0000-\u001f\u007f\\]/.test(next)) return '/';
  const base = 'https://this.site';
  try {
    if (new URL(next, base).origin !== base) return '/';
  } catch {
    return '/';
  }
  const path = next.split(/[?#]/)[0];
  if (path === '/login' || path.startsWith('/api/auth')) return '/';
  return next;
}

// A sign-in form must be posted from this site (the browser sets Origin on every form post).
export function sameOrigin(headers: Headers): boolean {
  const origin = headers.get('origin');
  const host = headers.get('x-forwarded-host') ?? headers.get('host');
  if (!origin || !host) return false;
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}
