import type { NextRequest } from 'next/server';
import { backToLogin, field, refuseFormPost, seeOther } from '@/lib/auth/form-post';
import { owner } from '@/lib/auth/owner';
import { looksLikeEmail, passwordProblems } from '@/lib/auth/password';
import { neonAuth } from '@/lib/auth/server';

// The owner set-up form's post (app/login): creates the installation's one account, only while
// nobody has signed up yet, and signs the owner in.
export async function POST(request: NextRequest) {
  const refused = refuseFormPost(request);
  if (refused) return refused;
  const form = await request.formData();
  const email = field(form, 'email').trim().toLowerCase();
  const password = field(form, 'password');

  const auth = neonAuth();
  try {
    owner.forget();
    if ((await owner.ownerId()) !== null) return backToLogin(request, 'ownerExists');
    if (!looksLikeEmail(email)) return backToLogin(request, 'email');
    if (password !== field(form, 'confirm')) return backToLogin(request, 'mismatch');
    if (passwordProblems(password).length > 0) return backToLogin(request, 'weak');

    const { data, error } = await auth.signUp.email({ email, password, name: 'Owner' });
    if (error) return backToLogin(request, (error.status ?? 500) >= 500 ? 'unavailable' : 'signUpFailed');
    // Two set-ups at the same moment: the older account is the owner, the other is signed out.
    owner.forget();
    if (data?.user?.id === undefined || data.user.id !== (await owner.ownerId())) {
      await auth.signOut().catch(() => undefined);
      return backToLogin(request, 'ownerExists');
    }
  } catch (error) {
    console.error('Owner set-up failed', error);
    return backToLogin(request, 'unavailable');
  }
  return seeOther(request, '/');
}
