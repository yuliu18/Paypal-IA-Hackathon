import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { connection } from 'next/server';
import { getTranslations } from 'next-intl/server';
import { safeNextPath } from '@/lib/auth/access';
import { authMode } from '@/lib/auth/config';
import { owner } from '@/lib/auth/owner';
import { PASSWORD_MAX, PASSWORD_MIN } from '@/lib/auth/password';
import { BrandMark } from '../ui/brand-mark';

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations('auth'))('signIn.title') };
}

const ERRORS = ['invalid', 'locked', 'notOwner', 'ownerExists', 'email', 'mismatch', 'weak', 'signUpFailed', 'unavailable'] as const;
type ErrorCode = (typeof ERRORS)[number];
const isErrorCode = (value: unknown): value is ErrorCode => ERRORS.includes(value as ErrorCode);
const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);

const field = 'rounded-md border border-pp-border bg-pp-surface px-3 py-2 text-[15px] font-normal text-pp-ink';
const label = 'flex flex-col gap-1.5 text-sm font-semibold';
const button = 'mt-2 inline-flex items-center justify-center rounded-md bg-pp-blue px-4 py-2.5 text-sm font-semibold text-white hover:bg-pp-blue-dark';

// The owner's way in when Neon Auth protects the app (lib/auth/config.ts): the sign-in form, or,
// while the installation has no owner yet, the form that creates the owner account. Without Neon
// Auth the demo password protects the app and this page just leads home.
export default async function LoginPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await connection();
  if (authMode().kind !== 'neon') redirect('/');
  const t = await getTranslations('auth');
  const params = await searchParams;
  const next = safeNextPath(first(params.next));
  let error = first(params.error);

  let setup = false;
  try {
    setup = (await owner.ownerId()) === null;
  } catch (cause) {
    console.error('Owner lookup failed on the login page', cause);
    error = 'unavailable';
  }
  const mode = setup ? 'setup' : 'signIn';

  return (
    <main className="flex min-h-full items-center justify-center px-4 py-10 font-paypal text-pp-ink">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex items-center justify-center gap-2.5 font-semibold">
          <BrandMark className="size-8" />
          <span className="text-lg">Payment Guard</span>
        </div>
        <div className="rounded-lg border border-pp-border bg-pp-surface p-6 shadow-sm sm:p-8">
          <h1 className="text-[22px] font-semibold leading-tight tracking-[-0.01em]">{t(`${mode}.title`)}</h1>
          <p className="mt-1.5 text-[15px] leading-relaxed text-pp-muted">{t(`${mode}.intro`)}</p>
          {isErrorCode(error) && (
            <p role="alert" className="mt-5 rounded-md border border-pp-danger/30 bg-pp-danger-tint px-3 py-2 text-sm text-pp-danger">
              {t(`errors.${error}`)}
            </p>
          )}
          <form method="post" action={setup ? '/api/auth/owner' : '/api/auth/sign-in'} className="mt-6 flex flex-col gap-4">
            {!setup && <input type="hidden" name="next" value={next} />}
            <label className={label}>
              {t('fields.email')}
              <input className={field} type="email" name="email" autoComplete="email" required autoFocus />
            </label>
            <label className={label}>
              {t('fields.password')}
              <input
                className={field}
                type="password"
                name="password"
                autoComplete={setup ? 'new-password' : 'current-password'}
                required
                {...(setup ? { minLength: PASSWORD_MIN, maxLength: PASSWORD_MAX, 'aria-describedby': 'password-rule' } : {})}
              />
            </label>
            {setup && (
              <>
                <label className={label}>
                  {t('setup.confirm')}
                  <input className={field} type="password" name="confirm" autoComplete="new-password" required minLength={PASSWORD_MIN} maxLength={PASSWORD_MAX} />
                </label>
                <p id="password-rule" className="-mt-1 text-[13px] text-pp-muted">
                  {t('setup.rule')}
                </p>
              </>
            )}
            <button type="submit" className={button}>
              {t(`${mode}.submit`)}
            </button>
          </form>
        </div>
      </div>
    </main>
  );
}
