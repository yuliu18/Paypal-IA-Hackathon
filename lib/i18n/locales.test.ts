import { describe, expect, it } from 'vitest';
import { DEFAULT_LOCALE, isLocale, LOCALE_COOKIE, LOCALES } from './locales';

describe('locales', () => {
  it('offers English, Spanish, Simplified Chinese and French, each under its own name', () => {
    expect(LOCALES).toEqual([
      { code: 'en', label: 'English' },
      { code: 'es', label: 'Español' },
      { code: 'zh-CN', label: '简体中文' },
      { code: 'fr', label: 'Français' },
    ]);
  });

  it('falls back to English, kept in the "locale" cookie', () => {
    expect(DEFAULT_LOCALE).toBe('en');
    expect(LOCALE_COOKIE).toBe('locale');
  });

  it('accepts only the offered codes, exactly as written', () => {
    for (const code of ['en', 'es', 'zh-CN', 'fr']) expect(isLocale(code)).toBe(true);
    for (const value of ['', 'de', 'zh', 'zh-cn', 'EN', 'en-US', undefined, null, 1]) expect(isLocale(value)).toBe(false);
  });
});
