import type { NextRequest } from 'next/server';
import { safeNextPath } from '@/lib/auth/access';
import { backToLogin, field, refuseFormPost, seeOther } from '@/lib/auth/form-post';
import { limits } from '@/lib/auth/limits';
import { owner } from '@/lib/auth/owner';
import { neonAuth } from '@/lib/auth/server';
import { clientAddress } from '@/lib/demo-auth';

// 10 wrong passwords (or reset codes) lock that client out for 15 minutes; from the 5th in a row for
// one account, from any client, that account is locked for 1 minute, doubling with every further
// failure up to an hour (lib/auth/limits.ts).
const failures = limits.signInFailures;
const accounts = limits.accountFailures;

// The sign-in form's post (app/login). Only the owner's account may sign in here.
export async function POST(request: NextRequest) {
  const refused = refuseFormPost(request);
  if (refused) return refused;
  const form = await request.formData();
  const next = safeNextPath(field(form, 'next'));
  const email = field(form, 'email').trim().toLowerCase();
  const password = field(form, 'password');
  const client = clientAddress(request.headers);
  if (!email || !password) return backToLogin(request, 'invalid', next);
  const now = Date.now();
  if (failures.retryAfterMs(client, now) > 0 || accounts.retryAfterMs(email, now) > 0) return backToLogin(request, 'locked', next);

  const auth = neonAuth();
  try {
    const { data, error } = await auth.signIn.email({ email, password });
    if (error) {
      if ((error.status ?? 500) >= 500) return backToLogin(request, 'unavailable', next);
      failures.record(client, Date.now());
      accounts.recordFailure(email, Date.now());
      return backToLogin(request, 'invalid', next);
    }
    if (data?.user?.id === undefined || data.user.id !== (await owner.ownerId())) {
      await auth.signOut().catch(() => undefined);
      return backToLogin(request, 'notOwner', next);
    }
    accounts.recordSuccess(email);
  } catch (error) {
    console.error('Sign-in failed', error);
    return backToLogin(request, 'unavailable', next);
  }
  return seeOther(request, next);
}
