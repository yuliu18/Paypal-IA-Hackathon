import type { NextRequest } from 'next/server';
import { authMode } from '@/lib/auth/config';
import { backToLogin, field, refuseFormPost, seeOther } from '@/lib/auth/form-post';
import { sessionCookie, startSession } from '@/lib/auth/local-session';
import { localAuthStore } from '@/lib/auth/local-store';
import { owner } from '@/lib/auth/owner';
import { looksLikeEmail, passwordProblems } from '@/lib/auth/password';
import { hashPassword } from '@/lib/auth/scrypt';
import { neonAuth } from '@/lib/auth/server';

// The owner set-up form's post (app/login): creates the installation's one account, only while
// nobody has signed up yet, and signs the owner in. With Neon Auth the account lives there; without
// it, in the app's own store, where creating it is atomic (one owner row at most).
export async function POST(request: NextRequest) {
  const refused = refuseFormPost(request);
  if (refused) return refused;
  const form = await request.formData();
  const email = field(form, 'email').trim().toLowerCase();
  const password = field(form, 'password');
  const local = authMode().kind === 'local';

  let token: string | undefined;
  try {
    if (local) {
      if ((await localAuthStore().owner()) !== null) return backToLogin(request, 'ownerExists');
    } else {
      owner.forget();
      if ((await owner.ownerId()) !== null) return backToLogin(request, 'ownerExists');
    }
    if (!looksLikeEmail(email)) return backToLogin(request, 'email');
    if (password !== field(form, 'confirm')) return backToLogin(request, 'mismatch');
    if (passwordProblems(password).length > 0) return backToLogin(request, 'weak');

    if (local) {
      const store = localAuthStore();
      // Two set-ups at the same moment: only one row can be inserted; the other is refused.
      if (!(await store.createOwner({ email, passwordHash: await hashPassword(password) }, new Date()))) return backToLogin(request, 'ownerExists');
      token = await startSession(store);
    } else {
      const auth = neonAuth();
      const { data, error } = await auth.signUp.email({ email, password, name: 'Owner' });
      if (error) return backToLogin(request, (error.status ?? 500) >= 500 ? 'unavailable' : 'signUpFailed');
      // Two set-ups at the same moment: the older account is the owner, the other is signed out.
      owner.forget();
      if (data?.user?.id === undefined || data.user.id !== (await owner.ownerId())) {
        await auth.signOut().catch(() => undefined);
        return backToLogin(request, 'ownerExists');
      }
    }
  } catch (error) {
    console.error('Owner set-up failed', error);
    return backToLogin(request, 'unavailable');
  }
  const response = seeOther(request, '/');
  if (token !== undefined) {
    const { name, value, options } = sessionCookie(request, token);
    response.cookies.set(name, value, options);
  }
  return response;
}
