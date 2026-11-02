import type { NextRequest } from 'next/server';
import { safeNextPath } from '@/lib/auth/access';
import { backToLogin, field, refuseFormPost, seeOther } from '@/lib/auth/form-post';
import { limits } from '@/lib/auth/limits';
import { owner, ownerEmail } from '@/lib/auth/owner';
import { neonAuth } from '@/lib/auth/server';
import { clientAddress } from '@/lib/demo-auth';

// 10 wrong passwords (or reset codes) lock that client out for 15 minutes; from the 5th in a row for
// the owner's account, from any client, it is locked for 1 minute, doubling with every further
// failure up to an hour (lib/auth/limits.ts).
const failures = limits.signInFailures;

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

  // Only the owner's address is counted in the lockout that matters, so guesses at other addresses
  // can't push it out; they get the same answers from their own count, so "locked" never reveals
  // which address is the owner's.
  let isOwner: boolean;
  try {
    const address = await ownerEmail();
    isOwner = address !== null && address.trim().toLowerCase() === email;
  } catch (error) {
    console.error('Owner lookup failed while signing in', error);
    return backToLogin(request, 'unavailable', next);
  }
  const accounts = isOwner ? limits.accountFailures : limits.otherAccountFailures;
  // Reserved before asking Neon Auth, so guesses sent at the same moment can't all get through.
  if (!accounts.begin(email, Date.now())) return backToLogin(request, 'locked', next);

  const auth = neonAuth();
  try {
    const { data, error } = await auth.signIn.email({ email, password });
    if (error) {
      if ((error.status ?? 500) >= 500) {
        accounts.end(email, 'neutral', Date.now());
        return backToLogin(request, 'unavailable', next);
      }
      failures.record(client, Date.now());
      accounts.end(email, 'failure', Date.now());
      return backToLogin(request, 'invalid', next);
    }
    if (data?.user?.id === undefined || data.user.id !== (await owner.ownerId())) {
      accounts.end(email, 'neutral', Date.now());
      await auth.signOut().catch(() => undefined);
      return backToLogin(request, 'notOwner', next);
    }
    accounts.end(email, 'success', Date.now());
  } catch (error) {
    accounts.end(email, 'neutral', Date.now());
    console.error('Sign-in failed', error);
    return backToLogin(request, 'unavailable', next);
  }
  return seeOther(request, next);
}
