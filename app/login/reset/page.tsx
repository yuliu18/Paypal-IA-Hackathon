import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { connection } from 'next/server';
import { getTranslations } from 'next-intl/server';
import { authMode } from '@/lib/auth/config';
import { PASSWORD_MAX, PASSWORD_MIN } from '@/lib/auth/password';
import { AuthCard, buttonClass, fieldClass, first, labelClass, linkClass } from '../auth-card';

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations('auth'))('reset.title') };
}

const ERRORS = ['locked', 'email', 'mismatch', 'weak', 'invalidCode', 'unavailable'] as const;
type ErrorCode = (typeof ERRORS)[number];
const isErrorCode = (value: unknown): value is ErrorCode => ERRORS.includes(value as ErrorCode);

// The emailed code and a new password replace the owner's password (app/api/auth/reset). Only with
// Neon Auth; with the demo password there is no account to recover.
export default async function ResetPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await connection();
  if (authMode().kind !== 'neon') redirect('/');
  const t = await getTranslations('auth');
  const params = await searchParams;
  const error = first(params.error);
  const email = first(params.email) ?? '';

  return (
    <AuthCard title={t('reset.title')} intro={t('reset.intro')} error={isErrorCode(error) ? t(`errors.${error}`) : undefined}>
      <form method="post" action="/api/auth/reset" className="mt-6 flex flex-col gap-4">
        <label className={labelClass}>
          {t('fields.email')}
          <input className={fieldClass} type="email" name="email" autoComplete="email" required defaultValue={email} autoFocus={!email} />
        </label>
        <label className={labelClass}>
          {t('reset.code')}
          <input className={fieldClass} type="text" name="code" autoComplete="one-time-code" inputMode="numeric" required autoFocus={Boolean(email)} />
        </label>
        <label className={labelClass}>
          {t('reset.password')}
          <input className={fieldClass} type="password" name="password" autoComplete="new-password" required minLength={PASSWORD_MIN} maxLength={PASSWORD_MAX} aria-describedby="password-rule" />
        </label>
        <label className={labelClass}>
          {t('setup.confirm')}
          <input className={fieldClass} type="password" name="confirm" autoComplete="new-password" required minLength={PASSWORD_MIN} maxLength={PASSWORD_MAX} />
        </label>
        <p id="password-rule" className="-mt-1 text-[13px] text-pp-muted">
          {t('setup.rule')}
        </p>
        <button type="submit" className={buttonClass}>
          {t('reset.submit')}
        </button>
      </form>
      <p className="mt-5 flex flex-col items-center gap-2 text-center">
        <Link href="/login/forgot" className={linkClass}>
          {t('reset.resend')}
        </Link>
        <Link href="/login" className={linkClass}>
          {t('forgot.back')}
        </Link>
      </p>
    </AuthCard>
  );
}
