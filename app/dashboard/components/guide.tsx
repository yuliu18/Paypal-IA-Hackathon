'use client';

import type { ReactNode } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { studioLabel } from '../studio/locale';

// "How to use this dashboard": a panel at the right that stays open beside the report (no
// backdrop), so its steps can be followed while doing them. Names in bold are the labels on screen:
// ours from the dashboard's messages, AG Studio's (Compose, Data, Filters…) from the same locale
// map Studio shows (../studio/locale), so both read the same in every language.

function Step({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="border-b border-pp-gridline py-4 last:border-b-0">
      <h3 className="text-sm font-semibold text-pp-ink">{title}</h3>
      <div className="mt-1.5 space-y-1.5 text-sm leading-relaxed text-pp-muted">{children}</div>
    </section>
  );
}

const b = (chunks: ReactNode) => <strong className="font-semibold text-pp-ink">{chunks}</strong>;

export function GuidePanel({ open, onClose, aiEnabled }: { open: boolean; onClose: () => void; aiEnabled: boolean }) {
  const t = useTranslations('dashboard');
  const nav = useTranslations('nav');
  const locale = useLocale();
  if (!open) return null;

  // Every on-screen label the guide names, as the screen shows it in this language.
  const labels = {
    compose: studioLabel(locale, 'panelTitleEdit'),
    data: studioLabel(locale, 'panelTitleData'),
    filters: studioLabel(locale, 'panelTitleFilters'),
    widgets: studioLabel(locale, 'setupPanelTabWidgets'),
    assistant: studioLabel(locale, 'panelTitleAi'),
    dashboard: nav('items.dashboard'),
    flow: t('widgets.guardFlow'),
    group: t('widgets.menuGroup'),
    addPage: t('sidebar.addPage'),
    newReport: t('sidebar.newReport'),
    rename: t('sidebar.rename'),
    duplicate: t('sidebar.duplicate'),
    resetDemo: t('sidebar.resetDemo'),
    edit: t('header.edit'),
    save: t('header.save'),
    discard: t('header.discard'),
    view: t('header.view'),
    b,
  };
  const say = (key: string) => <p>{t.rich(`guide.${key}`, labels)}</p>;

  return (
    <aside
      aria-label={t('guide.title')}
      className="fixed inset-y-0 right-0 z-40 flex w-full max-w-[400px] flex-col border-l border-pp-border bg-pp-surface font-paypal text-pp-ink shadow-[-8px_0_24px_rgba(11,31,68,0.08)]"
    >
      <header className="flex items-start justify-between gap-4 border-b border-pp-border px-5 py-4">
        <div>
          <h2 className="text-base font-semibold">{t('guide.title')}</h2>
          <p className="mt-0.5 text-sm text-pp-muted">{t('guide.intro')}</p>
        </div>
        <button type="button" onClick={onClose} aria-label={t('guide.close')} className="rounded-md p-1.5 text-pp-muted hover:bg-pp-canvas hover:text-pp-ink">
          <svg viewBox="0 0 24 24" className="size-4 fill-none stroke-current" strokeWidth={2} strokeLinecap="round" aria-hidden>
            <path d="M6 6l12 12M18 6 6 18" />
          </svg>
        </button>
      </header>
      <div className="flex-1 overflow-y-auto px-5">
        <Step title={t('guide.read.title')}>{say('read.body')}</Step>
        <Step title={t('guide.filter.title')}>
          {say('filter.click')}
          {say('filter.panel')}
        </Step>
        <Step title={t('guide.pages.title')}>
          {say('pages.menu')}
          {say('pages.reports')}
        </Step>
        <Step title={t('guide.edit.title')}>
          {say('edit.open')}
          {say('edit.add')}
          {say('edit.change')}
          {say('edit.move')}
          {say('edit.save')}
        </Step>
        <Step title={t('guide.guardWidget.title')}>{say('guardWidget.body')}</Step>
        <Step title={t('guide.export.title')}>{say('export.body')}</Step>
        <Step title={t('guide.ai.title')}>{say(aiEnabled ? 'ai.on' : 'ai.off')}</Step>
      </div>
    </aside>
  );
}
