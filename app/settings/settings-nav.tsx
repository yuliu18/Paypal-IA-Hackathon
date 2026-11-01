'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { sectionFrom, SETTINGS_SECTIONS } from './sections';

// The settings sections, listed in the side menu under "Settings" (like the dashboard's pages under
// "Dashboard"), so the page has one menu rather than two. Each links to /settings?section=<id>, which
// the page opens (./settings-editor.tsx). `row`: on phones, where the side menu is a top bar, the
// page shows them as a scrolling row instead.
export function SettingsNav({ row = false }: { row?: boolean }) {
  const t = useTranslations('settings');
  const open = sectionFrom(useSearchParams().get('section'));
  return (
    <ul
      className={row ? 'flex gap-1 overflow-x-auto' : 'mt-0.5 mb-1 ml-4 space-y-0.5 border-l border-pp-border pl-2'}
      aria-label={t('sectionsLabel')}
    >
      {SETTINGS_SECTIONS.map((section) => {
        const current = section.id === open;
        return (
          <li key={section.id} className={row ? 'shrink-0' : ''}>
            <Link
              href={`/settings?section=${section.id}`}
              replace
              scroll={false}
              aria-current={current ? 'page' : undefined}
              className={`block rounded px-2 py-1.5 text-sm ${current ? 'bg-pp-highlight font-semibold text-pp-blue' : 'text-pp-muted hover:bg-pp-canvas hover:text-pp-ink'}`}
            >
              {t(`sections.${section.id}`)}
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
