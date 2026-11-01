import { NextResponse, type NextRequest } from 'next/server';
import { authMode } from '@/lib/auth/config';
import { gate } from '@/lib/auth/gate';
import { owner } from '@/lib/auth/owner';
import { readSession } from '@/lib/auth/session';
import { clientAddress, demoAccess, FailedAttempts } from '@/lib/demo-auth';

// 10 wrong passwords lock that client out for 15 minutes.
const failures = new FailedAttempts({ maxFailures: 10, windowMs: 15 * 60_000 });

// Without Neon Auth: every page and API route sits behind the demo password (lib/demo-auth.ts).
function demoGate(request: NextRequest) {
  const client = clientAddress(request.headers);
  const now = Date.now();
  const access = demoAccess({
    authorization: request.headers.get('authorization'),
    password: process.env.DEMO_PASSWORD,
    production: process.env.NODE_ENV === 'production',
    attempts: { failures, client, now },
  });
  if (access === 'allow') return NextResponse.next();
  if (access === 'locked') {
    const retryAfter = Math.ceil(failures.retryAfterMs(client, now) / 1000);
    return new NextResponse('Too many wrong passwords. Try again later.', { status: 429, headers: { 'Retry-After': String(retryAfter) } });
  }
  if (access === 'unconfigured') return new NextResponse('DEMO_PASSWORD is not set.', { status: 503 });
  return new NextResponse('Authentication required.', {
    status: 401,
    headers: { 'WWW-Authenticate': 'Basic realm="PayPal payment guard demo", charset="UTF-8"' },
  });
}

// With Neon Auth (NEON_AUTH_BASE_URL set), only the owner's session opens a page or API route
// (lib/auth/gate.ts); without it, the demo password. Static assets don't pass through here.
export function proxy(request: NextRequest) {
  const mode = authMode();
  return gate(request, {
    mode,
    demo: demoGate,
    session: (req) => (mode.kind === 'neon' ? readSession(req, mode) : Promise.resolve({ userId: undefined, cookies: [] })),
    ownerId: () => owner.ownerId(),
  });
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
