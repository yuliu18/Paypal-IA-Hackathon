import { NEON_AUTH_COOKIE_PREFIX } from '@neon/auth/server';
import { cookies } from 'next/headers';
import type { NextRequest } from 'next/server';
import { refuseFormPost, seeOther } from '@/lib/auth/form-post';
import { neonAuth } from '@/lib/auth/server';

// The side menu's "Sign out" button: ends the session at Neon Auth, clears its cookies here too
// (even when Neon Auth can't be reached), and shows the login page.
export async function POST(request: NextRequest) {
  const refused = refuseFormPost(request);
  if (refused) return refused;
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
