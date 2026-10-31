'use server';

import { refresh } from 'next/cache';
import { cookies } from 'next/headers';
import { isLocale, LOCALE_COOKIE } from '@/lib/i18n/locales';

const YEAR = 60 * 60 * 24 * 365;

// The interface's language, kept for a year in this browser's cookie (i18n/request.ts reads it).
// Apart from the settings form: it saves nothing else and works on a read-only server too.
export async function setLocaleAction(locale: string): Promise<boolean> {
  if (!isLocale(locale)) return false;
  (await cookies()).set(LOCALE_COOKIE, locale, { maxAge: YEAR, path: '/', sameSite: 'lax' });
  refresh();
  return true;
}
