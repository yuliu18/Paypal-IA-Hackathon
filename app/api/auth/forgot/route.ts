import type { NextRequest } from 'next/server';
import { field, refuseFormPost, seeOther } from '@/lib/auth/form-post';
import { limits } from '@/lib/auth/limits';
import { ownerEmail } from '@/lib/auth/owner';
import { requestResetCode } from '@/lib/auth/recovery';
import { neonAuth } from '@/lib/auth/server';
import { clientAddress } from '@/lib/demo-auth';

// The forgot-password form's post (app/login/forgot): Neon Auth emails a reset code, only when the
// address is the owner's, and the answer is the same for any address (lib/auth/recovery.ts).
export async function POST(request: NextRequest) {
  const refused = refuseFormPost(request);
  if (refused) return refused;
  const form = await request.formData();
  const email = field(form, 'email').trim();
  const outcome = await requestResetCode(
    { email, client: clientAddress(request.headers), now: Date.now() },
    {
      ownerEmail,
      sendCode: async (address) => {
        const { error } = await neonAuth().emailOtp.sendVerificationOtp({ email: address, type: 'forget-password' });
        if (error) throw new Error(`Neon Auth refused to send the reset code (${error.status ?? 'no status'})`);
      },
      requests: limits.codeRequests,
      throttle: limits.codeThrottle,
    },
  );
  if (outcome !== 'sent') return seeOther(request, `/login/forgot?${new URLSearchParams({ error: outcome })}`);
  return seeOther(request, `/login/reset?${new URLSearchParams({ email })}`);
}
