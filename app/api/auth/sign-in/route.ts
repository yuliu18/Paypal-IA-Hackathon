import type { NextRequest } from 'next/server';
import { safeNextPath } from '@/lib/auth/access';
import { authMode } from '@/lib/auth/config';
import { clientAddress } from '@/lib/auth/failed-attempts';
import { backToLogin, field, refuseFormPost, seeOther } from '@/lib/auth/form-post';
import { limits } from '@/lib/auth/limits';
import { sessionCookie, startSession } from '@/lib/auth/local-session';
import { localAuthStore, type LocalOwner } from '@/lib/auth/local-store';
import { owner, ownerEmail } from '@/lib/auth/owner';
import { spendPasswordCheck, verifyPassword } from '@/lib/auth/scrypt';
import { neonAuth } from '@/lib/auth/server';
import { signInOwner, type PasswordCheck, type SignInDeps } from '@/lib/auth/sign-in';

// With Neon Auth: its own sign-in, then only the owner's account may stay signed in.
function neonCheck(email: string, password: string): Pick<SignInDeps, 'ownerEmail' | 'check'> {
  return {
    ownerEmail,
    async check(): Promise<PasswordCheck> {
      const auth = neonAuth();
      const { data, error } = await auth.signIn.email({ email, password });
      if (error) return (error.status ?? 500) >= 500 ? 'unavailable' : 'wrong';
      if (data?.user?.id === undefined || data.user.id !== (await owner.ownerId())) {
        await auth.signOut().catch(() => undefined);
        return 'notOwner';
      }
      return 'ok';
    },
  };
}

// With the built-in account: the scrypt hash in the store. An address that is not the owner's still
// costs one hash, so the answer's timing doesn't tell. A right password starts a session.
function localCheck(password: string, signedIn: (token: string) => void): Pick<SignInDeps, 'ownerEmail' | 'check'> {
  let account: LocalOwner | null = null;
  return {
    async ownerEmail() {
      account = await localAuthStore().owner();
      return account?.email ?? null;
    },
    async check(isOwner): Promise<PasswordCheck> {
      if (!isOwner || account === null) return spendPasswordCheck(password).then(() => 'wrong');
      if (!(await verifyPassword(password, account.passwordHash))) return 'wrong';
      signedIn(await startSession(localAuthStore()));
      return 'ok';
    },
  };
}

// The sign-in form's post (app/login). Only the owner's account may sign in here, with the limits
// lib/auth/sign-in.ts describes.
export async function POST(request: NextRequest) {
  const refused = refuseFormPost(request);
  if (refused) return refused;
  const form = await request.formData();
  const next = safeNextPath(field(form, 'next'));
  const email = field(form, 'email').trim().toLowerCase();
  const password = field(form, 'password');

  let token: string | undefined;
  const outcome = await signInOwner(
    { email, password, client: clientAddress(request.headers) },
    {
      ...(authMode().kind === 'neon' ? neonCheck(email, password) : localCheck(password, (t) => (token = t))),
      failures: limits.signInFailures,
      accounts: limits.accountFailures,
      otherAccounts: limits.otherAccountFailures,
    },
  );
  if (outcome !== 'ok') return backToLogin(request, outcome, next);
  const response = seeOther(request, next);
  if (token !== undefined) {
    const { name, value, options } = sessionCookie(request, token);
    response.cookies.set(name, value, options);
  }
  return response;
}
