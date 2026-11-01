// What the sign-in form posts share (app/api/auth/*): only with Neon Auth, only from this site,
// and the answer is always a 303 back to a page, so the browser follows it with a GET.

import { NextResponse, type NextRequest } from 'next/server';
import { sameOrigin } from './access';
import { authMode } from './config';

export const seeOther = (request: NextRequest, path: string) => NextResponse.redirect(new URL(path, request.url), 303);

// Back to the login page with an error code (messages/<locale>/auth.json → errors.<code>).
export function backToLogin(request: NextRequest, error: string, next = '/') {
  const params = new URLSearchParams({ error });
  if (next !== '/') params.set('next', next);
  return seeOther(request, `/login?${params}`);
}

// Undefined when the post may go ahead; otherwise the refusal to return.
export function refuseFormPost(request: NextRequest): NextResponse | undefined {
  if (authMode().kind !== 'neon') return new NextResponse('Not found.', { status: 404 });
  if (!sameOrigin(request.headers)) return new NextResponse('Cross-site form posts are refused.', { status: 403 });
  return undefined;
}

export const field = (form: FormData, name: string) => {
  const value = form.get(name);
  return typeof value === 'string' ? value : '';
};
