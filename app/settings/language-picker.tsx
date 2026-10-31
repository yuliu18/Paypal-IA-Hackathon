'use client';

import { useLocale, useTranslations } from 'next-intl';
import { useOptimistic, useState, useTransition } from 'react';
import { LOCALES } from '@/lib/i18n/locales';
import { Spinner } from '../ui/desk';
import { setLocaleAction } from './language-actions';

// The four languages, each under its own name. Picking one switches the whole interface at once,
// through its own server action: the settings form is neither submitted nor reset.
export function LanguagePicker() {
  const t = useTranslations('settings.language');
  const locale = useLocale();
  const [shown, setShown] = useOptimistic(locale);
  const [pending, startTransition] = useTransition();
  const [failed, setFailed] = useState(false);

  function choose(code: string) {
    setFailed(false);
    startTransition(async () => {
      setShown(code);
      const ok = await setLocaleAction(code).catch(() => false);
      if (!ok) setFailed(true);
    });
  }

  return (
    <div role="radiogroup" aria-label={t('label')} className="space-y-2 sm:col-span-2">
      {LOCALES.map(({ code, label }) => (
        <label
          key={code}
          lang={code}
          className={`flex max-w-sm cursor-pointer items-center gap-3 rounded-md border px-4 py-3 text-sm ${shown === code ? 'border-pp-blue bg-pp-highlight font-semibold text-pp-blue' : 'border-pp-border text-pp-ink hover:border-pp-blue'}`}
        >
          <input type="radio" name="interfaceLocale" value={code} checked={shown === code} onChange={() => choose(code)} disabled={pending} className="accent-pp-blue" />
          {label}
        </label>
      ))}
      <p className="flex items-center gap-2 text-sm text-pp-muted" aria-live="polite">
        {pending && (
          <>
            <Spinner /> {t('saving')}
          </>
        )}
        {failed && <span className="text-pp-danger">{t('failed')}</span>}
      </p>
    </div>
  );
}
