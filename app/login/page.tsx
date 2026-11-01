import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { connection } from 'next/server';
import { getTranslations } from 'next-intl/server';
import { safeNextPath } from '@/lib/auth/access';
import { authMode } from '@/lib/auth/config';
import { owner } from '@/lib/auth/owner';
import { PASSWORD_MAX, PASSWORD_MIN } from '@/lib/auth/password';
import { AuthCard, buttonClass, fieldClass, first, labelClass, linkClass } from './auth-card';

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations('auth'))('signIn.title') };
}

const ERRORS = ['invalid', 'locked', 'notOwner', 'ownerExists', 'email', 'mismatch', 'weak', 'signUpFailed', 'unavailable'] as const;
type ErrorCode = (typeof ERRORS)[number];
const isErrorCode = (value: unknown): value is ErrorCode => ERRORS.includes(value as ErrorCode);

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
  const notice = !setup && first(params.reset) === 'done' ? t('signIn.resetDone') : undefined;

  return (
    <AuthCard title={t(`${mode}.title`)} intro={t(`${mode}.intro`)} error={isErrorCode(error) ? t(`errors.${error}`) : undefined} notice={notice}>
      <form method="post" action={setup ? '/api/auth/owner' : '/api/auth/sign-in'} className="mt-6 flex flex-col gap-4">
        {!setup && <input type="hidden" name="next" value={next} />}
        <label className={labelClass}>
          {t('fields.email')}
          <input className={fieldClass} type="email" name="email" autoComplete="email" required autoFocus />
        </label>
        <label className={labelClass}>
          {t('fields.password')}
          <input
            className={fieldClass}
            type="password"
            name="password"
            autoComplete={setup ? 'new-password' : 'current-password'}
            required
            {...(setup ? { minLength: PASSWORD_MIN, maxLength: PASSWORD_MAX, 'aria-describedby': 'password-rule' } : {})}
          />
        </label>
        {setup && (
          <>
            <label className={labelClass}>
              {t('setup.confirm')}
              <input className={fieldClass} type="password" name="confirm" autoComplete="new-password" required minLength={PASSWORD_MIN} maxLength={PASSWORD_MAX} />
            </label>
            <p id="password-rule" className="-mt-1 text-[13px] text-pp-muted">
              {t('setup.rule')}
            </p>
          </>
        )}
        <button type="submit" className={buttonClass}>
          {t(`${mode}.submit`)}
        </button>
      </form>
      {!setup && (
        <p className="mt-5 text-center">
          <Link href="/login/forgot" className={linkClass}>
            {t('signIn.forgot')}
          </Link>
        </p>
      )}
    </AuthCard>
  );
}
