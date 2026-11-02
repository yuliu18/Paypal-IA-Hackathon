import type { NextRequest } from 'next/server';
import { field, refuseFormPost, seeOther } from '@/lib/auth/form-post';
import { limits } from '@/lib/auth/limits';
import { ownerEmail } from '@/lib/auth/owner';
import { resetOwnerPassword } from '@/lib/auth/recovery';
import { neonAuth, signOutEverywhere } from '@/lib/auth/server';
import { clientAddress } from '@/lib/auth/failed-attempts';

// The reset form's post (app/login/reset): the emailed code and a new password replace the owner's
// password, then every session of the owner is signed out (lib/auth/recovery.ts).
// Neon Auth only: the built-in owner account is recovered on the server (npm run owner:reset).
export async function POST(request: NextRequest) {
  const refused = refuseFormPost(request, { neonOnly: true });
  if (refused) return refused;
  const form = await request.formData();
  const email = field(form, 'email').trim();
  const outcome = await resetOwnerPassword(
    { email, code: field(form, 'code'), password: field(form, 'password'), confirm: field(form, 'confirm'), client: clientAddress(request.headers), now: Date.now() },
    {
      ownerEmail,
      resetPassword: async ({ email: address, code, password }) => {
        try {
          const { error } = await neonAuth().emailOtp.resetPassword({ email: address, otp: code, password });
          if (!error) return 'done';
          return (error.status ?? 500) >= 500 ? 'unavailable' : 'invalidCode';
        } catch (error) {
          console.error('Password reset failed at Neon Auth', error);
          return 'unavailable';
        }
      },
      signOutEverywhere: (input) => signOutEverywhere({ ...input, origin: request.headers.get('origin') ?? request.nextUrl.origin }),
      failures: limits.signInFailures,
      accounts: limits.accountFailures,
      otherAccounts: limits.otherAccountFailures,
    },
  );
  if (outcome === 'done') return seeOther(request, '/login?reset=done');
  return seeOther(request, `/login/reset?${new URLSearchParams({ email, error: outcome })}`);
}
