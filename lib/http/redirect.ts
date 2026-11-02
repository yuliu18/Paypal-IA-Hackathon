import { NextResponse } from 'next/server';

// A redirect to a path on this site, sent as a relative Location: the browser resolves it against
// the address it is on. Never built from request.url, which behind a host's proxy (Render) names
// the server's internal address (http://localhost:10000) instead of the public one.
// Only a path that stays on this site: `//host` or `/\host` would leave it.
export function relativeRedirect(path: string, status: 303 | 307 = 307): NextResponse {
  if (!/^\/(?![/\\])/.test(path)) throw new Error('A redirect must name a path on this site');
  return new NextResponse(null, { status, headers: { Location: path } });
}
