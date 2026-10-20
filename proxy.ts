import { NextResponse, type NextRequest } from 'next/server';
import { demoAccess } from '@/lib/demo-auth';

// Every page and API route sits behind the demo password (lib/demo-auth.ts); static assets don't.
export function proxy(request: NextRequest) {
  const access = demoAccess({
    authorization: request.headers.get('authorization'),
    password: process.env.DEMO_PASSWORD,
    production: process.env.NODE_ENV === 'production',
  });
  if (access === 'allow') return NextResponse.next();
  if (access === 'unconfigured') return new NextResponse('DEMO_PASSWORD is not set.', { status: 503 });
  return new NextResponse('Authentication required.', {
    status: 401,
    headers: { 'WWW-Authenticate': 'Basic realm="PayPal payment guard demo", charset="UTF-8"' },
  });
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
