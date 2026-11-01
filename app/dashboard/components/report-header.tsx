'use client';

import { useSyncExternalStore, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import type { Translate } from '../translate';
import { studioLabel } from '../studio/locale';
import { EditIcon, EyeIcon, RedoIcon, RefreshIcon, UndoIcon } from './ui/icons';
import { AgStudioLogo } from './ui/logo';
import { Button, IconButton } from './ui/ui';

// The bar above Studio: which report and page you're on, how fresh the data is, and the
// Edit / Save / Discard controls.
export function ReportHeader({
  reportName,
  pageTitle,
  asOf,
  editing,
  pageIsEmpty,
  canUndo,
  canRedo,
  onUndo,
  onRedo,
  onSave,
  onDiscard,
  onEditingChange,
  onGuide,
}: {
  reportName: string;
  pageTitle?: string;
  asOf: string;
  editing: boolean;
  pageIsEmpty: boolean;
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  onSave: () => void;
  onDiscard: () => void;
  onEditingChange: (editing: boolean) => void;
  // Opens the guide on using the dashboard (./guide.tsx).
  onGuide: () => void;
}) {
  const t = useTranslations('dashboard.header');
  const locale = useLocale();
  return (
    <div className="mx-4 flex flex-wrap items-start gap-x-6 gap-y-3 border-b border-pp-border pt-6 pb-5 sm:mx-8 sm:pt-8">
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm text-pp-muted">{reportName}</p>
        <h1 className="mt-1 truncate text-[28px] font-semibold leading-tight tracking-[-0.01em] text-pp-ink">{pageTitle}</h1>
        <DataFreshness asOf={asOf} />
      </div>
      <div className="flex items-center gap-2">
        {editing && pageIsEmpty && (
          <p className="mr-2 text-sm text-pp-muted">
            {t.rich('dragHint', {
              compose: studioLabel(locale, 'panelTitleEdit'),
              b: (chunks) => <span className="font-semibold text-pp-navy">{chunks}</span>,
            })}
          </p>
        )}
        {editing && (
          <>
            <IconButton label={t('undo')} disabled={!canUndo} onClick={onUndo}>
              <UndoIcon />
            </IconButton>
            <IconButton label={t('redo')} disabled={!canRedo} onClick={onRedo}>
              <RedoIcon />
            </IconButton>
            <span className="mx-2 h-6 w-px bg-pp-border" aria-hidden />
            <Button onClick={onDiscard} size="sm">
              {t('discard')}
            </Button>
            <Button variant="primary" size="sm" onClick={onSave}>
              {t('save')}
            </Button>
          </>
        )}
        <Button variant="ghost" size="sm" onClick={onGuide}>
          <svg viewBox="0 0 24 24" className="size-4 fill-none stroke-current" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M12 7c-1.5-1.3-3.6-2-6-2H4v13h2c2.4 0 4.5.7 6 2 1.5-1.3 3.6-2 6-2h2V5h-2c-2.4 0-4.5.7-6 2zM12 7v13" />
          </svg>
          {t('guide')}
        </Button>
        {editing ? (
          <Button variant="ghost" size="sm" onClick={() => onEditingChange(false)}>
            <EyeIcon className="size-4" /> {t('view')}
          </Button>
        ) : (
          <Button variant="ghost" size="sm" onClick={() => onEditingChange(true)}>
            <EditIcon className="size-4" /> {t('edit')}
          </Button>
        )}
      </div>
    </div>
  );
}

// --- Data freshness -----------------------------------------------------------------

const MINUTE_MS = 60_000;
let now = 0;
const subscribeNow = (listener: () => void) => {
  now = Date.now();
  const id = setInterval(() => {
    now = Date.now();
    listener();
  }, 30_000);
  return () => clearInterval(id);
};

// Dates and times as in English (en-GB) for English, in the language's own way otherwise.
const dateLocale = (locale: string) => (locale === 'en' ? 'en-GB' : locale);

function relativeTime(iso: string, at: number, t: Translate, locale: string) {
  const minutes = Math.floor((at - Date.parse(iso)) / MINUTE_MS);
  if (minutes < 1) return t('justNow');
  if (minutes < 60) return t('minutesAgo', { minutes });
  const hours = Math.floor(minutes / 60);
  return hours < 24 ? t('hoursAgo', { hours }) : new Date(iso).toLocaleDateString(dateLocale(locale), { timeZone: 'UTC' });
}

function DataFreshness({ asOf }: { asOf: string }) {
  const router = useRouter();
  const [refreshing, startRefresh] = useTransition();
  const at = useSyncExternalStore(subscribeNow, () => now, () => 0);
  const t = useTranslations('dashboard.header');
  const locale = useLocale();
  const utc = (time: string) => t('utc', { time });

  return (
    <p className="mt-2 flex flex-wrap items-center gap-x-5 gap-y-1 text-sm text-pp-muted">
      <span className="whitespace-nowrap">{t('sandbox')}</span>
      <span className="inline-flex items-center gap-1 whitespace-nowrap">
        <span title={utc(new Date(asOf).toLocaleString(dateLocale(locale), { timeZone: 'UTC' }))}>
          {refreshing
            ? t('refreshing')
            : t('updated', {
                when: at ? relativeTime(asOf, at, t, locale) : utc(new Date(asOf).toLocaleTimeString(dateLocale(locale), { timeZone: 'UTC' })),
              })}
        </span>
        <button
          type="button"
          onClick={() => startRefresh(() => router.refresh())}
          disabled={refreshing}
          aria-label={t('refresh')}
          title={t('refresh')}
          className="inline-flex size-7 items-center justify-center rounded-full text-pp-blue hover:bg-pp-highlight focus-visible:outline-2 focus-visible:outline-pp-blue disabled:text-pp-muted"
        >
          <RefreshIcon className={`size-4 ${refreshing ? 'animate-spin' : ''}`} />
        </button>
      </span>
      <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
        {t.rich('builtWith', { logo: () => <AgStudioLogo className="h-5 w-auto text-pp-navy" /> })}
      </span>
    </p>
  );
}
