import type { NextRequest } from 'next/server';
import { safeNextPath } from '@/lib/auth/access';
import { backToLogin, field, refuseFormPost, seeOther } from '@/lib/auth/form-post';
import { owner } from '@/lib/auth/owner';
import { neonAuth } from '@/lib/auth/server';
import { clientAddress, FailedAttempts } from '@/lib/demo-auth';

// 10 wrong passwords lock that client out of signing in for 15 minutes (Neon Auth limits too).
const failures = new FailedAttempts({ maxFailures: 10, windowMs: 15 * 60_000 });

// The sign-in form's post (app/login). Only the owner's account may sign in here.
export async function POST(request: NextRequest) {
  const refused = refuseFormPost(request);
  if (refused) return refused;
  const form = await request.formData();
  const next = safeNextPath(field(form, 'next'));
  const email = field(form, 'email').trim().toLowerCase();
  const password = field(form, 'password');
  const client = clientAddress(request.headers);
  if (failures.retryAfterMs(client, Date.now()) > 0) return backToLogin(request, 'locked', next);
  if (!email || !password) return backToLogin(request, 'invalid', next);

  const auth = neonAuth();
  try {
    const { data, error } = await auth.signIn.email({ email, password });
    if (error) {
      if ((error.status ?? 500) >= 500) return backToLogin(request, 'unavailable', next);
      failures.record(client, Date.now());
      return backToLogin(request, 'invalid', next);
    }
    if (data?.user?.id === undefined || data.user.id !== (await owner.ownerId())) {
      await auth.signOut().catch(() => undefined);
      return backToLogin(request, 'notOwner', next);
    }
  } catch (error) {
    console.error('Sign-in failed', error);
    return backToLogin(request, 'unavailable', next);
  }
  return seeOther(request, next);
}
