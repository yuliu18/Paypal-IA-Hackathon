import { NextResponse, type NextRequest } from 'next/server';
import { clientAddress, demoAccess, FailedAttempts } from '@/lib/demo-auth';

// 10 wrong passwords lock that client out for 15 minutes.
const failures = new FailedAttempts({ maxFailures: 10, windowMs: 15 * 60_000 });

// Every page and API route sits behind the demo password (lib/demo-auth.ts); static assets don't.
export function proxy(request: NextRequest) {
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

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
