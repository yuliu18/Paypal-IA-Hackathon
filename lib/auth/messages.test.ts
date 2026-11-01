import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { LOCALES } from '@/lib/i18n/locales';
import { MESSAGE_AREAS, type Messages } from '@/lib/i18n/messages';

const read = (locale: string, area: string) => JSON.parse(readFileSync(new URL(`../../messages/${locale}/${area}.json`, import.meta.url), 'utf8')) as Messages;
const keys = (messages: Messages, prefix = ''): string[] =>
  Object.entries(messages).flatMap(([key, value]) => (typeof value === 'string' ? [`${prefix}${key}`] : keys(value, `${prefix}${key}.`)));

describe('the login messages', () => {
  it('are an area of their own', () => {
    expect(MESSAGE_AREAS).toContain('auth');
  });

  it('have the same keys, none empty, in every language', () => {
    const english = keys(read('en', 'auth')).sort();
    for (const { code } of LOCALES) {
      const messages = read(code, 'auth');
      expect(keys(messages).sort()).toEqual(english);
      expect(JSON.stringify(messages)).not.toContain('""');
    }
  });

  it('give the side menu its sign-out label in every language', () => {
    for (const { code } of LOCALES) expect(read(code, 'nav').signOut).toEqual(expect.any(String));
  });
});
