// The interface's languages, each named in itself so anyone can find their own. The choice lives
// in a cookie, per browser; there is no locale in the URL.
export const LOCALES = [
  { code: 'en', label: 'English' },
  { code: 'es', label: 'Español' },
  { code: 'zh-CN', label: '简体中文' },
  { code: 'fr', label: 'Français' },
] as const;

export type Locale = (typeof LOCALES)[number]['code'];

export const DEFAULT_LOCALE: Locale = 'en';

export const LOCALE_COOKIE = 'locale';

export function isLocale(value: unknown): value is Locale {
  return LOCALES.some((locale) => locale.code === value);
}
