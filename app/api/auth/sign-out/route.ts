import { NEON_AUTH_COOKIE_PREFIX } from '@neon/auth/server';
import { cookies } from 'next/headers';
import type { NextRequest } from 'next/server';
import { authMode } from '@/lib/auth/config';
import { refuseFormPost, seeOther } from '@/lib/auth/form-post';
import { clearedSessionCookie, endSession } from '@/lib/auth/local-session';
import { localAuthStore } from '@/lib/auth/local-store';
import { neonAuth } from '@/lib/auth/server';

// The side menu's "Sign out" button: ends the session (at Neon Auth, or in the app's own store),
// clears its cookies here too (even when the session can't be ended there), and shows the login page.
export async function POST(request: NextRequest) {
  const refused = refuseFormPost(request);
  if (refused) return refused;

  if (authMode().kind === 'local') {
    try {
      await endSession(localAuthStore(), request);
    } catch (error) {
      console.error('Ending the session failed; clearing the session cookie anyway', error);
    }
    const response = seeOther(request, '/login');
    const { name, value, options } = clearedSessionCookie(request);
    response.cookies.set(name, value, options);
    return response;
  }

  try {
    await neonAuth().signOut();
  } catch (error) {
    console.error('Sign-out failed at Neon Auth; clearing the session cookies anyway', error);
  }
  const store = await cookies();
  for (const { name } of store.getAll()) {
    if (name.includes(NEON_AUTH_COOKIE_PREFIX)) store.set(name, '', { maxAge: 0, path: '/', secure: true, httpOnly: true, sameSite: 'lax' });
  }
  return seeOther(request, '/login');
}
