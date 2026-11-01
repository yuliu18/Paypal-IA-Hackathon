import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { connection } from 'next/server';
import { getTranslations } from 'next-intl/server';
import { authMode } from '@/lib/auth/config';
import { AuthCard, buttonClass, fieldClass, first, labelClass, linkClass } from '../auth-card';

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations('auth'))('forgot.title') };
}

const ERRORS = ['tooMany', 'email', 'unavailable'] as const;
type ErrorCode = (typeof ERRORS)[number];
const isErrorCode = (value: unknown): value is ErrorCode => ERRORS.includes(value as ErrorCode);

// Forgot password: the owner asks Neon Auth to email a reset code (app/api/auth/forgot). Only with
// Neon Auth; with the demo password there is no account to recover.
export default async function ForgotPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await connection();
  if (authMode().kind !== 'neon') redirect('/');
  const t = await getTranslations('auth');
  const error = first((await searchParams).error);

  return (
    <AuthCard title={t('forgot.title')} intro={t('forgot.intro')} error={isErrorCode(error) ? t(`errors.${error}`) : undefined}>
      <form method="post" action="/api/auth/forgot" className="mt-6 flex flex-col gap-4">
        <label className={labelClass}>
          {t('fields.email')}
          <input className={fieldClass} type="email" name="email" autoComplete="email" required autoFocus />
        </label>
        <button type="submit" className={buttonClass}>
          {t('forgot.submit')}
        </button>
      </form>
      <p className="mt-5 text-center">
        <Link href="/login" className={linkClass}>
          {t('forgot.back')}
        </Link>
      </p>
    </AuthCard>
  );
}
