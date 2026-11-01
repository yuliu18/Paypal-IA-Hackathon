'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { sectionFrom, SETTINGS_SECTIONS } from './sections';

// The settings sections, listed in the side menu under "Settings" (like the dashboard's pages under
// "Dashboard"), so the page has one menu rather than two. Each links to /settings?section=<id>, which
// the page opens (./settings-editor.tsx). On phones, where the side menu is a scrolling top bar,
// they sit in that bar after "Settings".
export function SettingsNav() {
  const t = useTranslations('settings');
  const open = sectionFrom(useSearchParams().get('section'));
  return (
    <ul
      className="flex shrink-0 gap-1 md:mt-0.5 md:mb-1 md:ml-4 md:block md:space-y-0.5 md:border-l md:border-pp-border md:pl-2"
      aria-label={t('sectionsLabel')}
    >
      {SETTINGS_SECTIONS.map((section) => {
        const current = section.id === open;
        return (
          <li key={section.id} className="shrink-0">
            <Link
              href={`/settings?section=${section.id}`}
              replace
              scroll={false}
              aria-current={current ? 'page' : undefined}
              className={`block whitespace-nowrap rounded px-2 py-1.5 text-sm ${current ? 'bg-pp-highlight font-semibold text-pp-blue' : 'text-pp-muted hover:bg-pp-canvas hover:text-pp-ink'}`}
            >
              {t(`sections.${section.id}`)}
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
