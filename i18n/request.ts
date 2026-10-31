import { cookies } from 'next/headers';
import { getRequestConfig } from 'next-intl/server';
import { DEFAULT_LOCALE, isLocale, LOCALE_COOKIE, type Locale } from '@/lib/i18n/locales';
import { MESSAGE_AREAS, withFallback, type Messages } from '@/lib/i18n/messages';

// One area's messages; an area not written yet for this language is empty, never an error.
async function area(locale: Locale, name: string): Promise<Messages> {
  try {
    return (await import(`../messages/${locale}/${name}.json`)).default as Messages;
  } catch {
    return {};
  }
}

async function load(locale: Locale): Promise<Messages> {
  const areas = await Promise.all(MESSAGE_AREAS.map(async (name) => [name, await area(locale, name)] as const));
  return Object.fromEntries(areas);
}

// next-intl without i18n routing: the language is the browser's `locale` cookie (set on
// /settings), English when it is missing or unknown.
export default getRequestConfig(async () => {
  const chosen = (await cookies()).get(LOCALE_COOKIE)?.value;
  const locale = isLocale(chosen) ? chosen : DEFAULT_LOCALE;
  const english = await load(DEFAULT_LOCALE);
  const messages = locale === DEFAULT_LOCALE ? english : withFallback(await load(locale), english);
  return { locale, messages };
});
