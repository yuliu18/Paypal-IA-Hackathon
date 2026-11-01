// AG Studio's own interface text per app language, for <AgStudio localeText> (read once, when
// Studio is created). English is AG Studio's default, so it needs no map. Keys a map leaves out
// show AG Studio's English.

import { DEFAULT_LOCALE, type AgStudioLocaleKey, type AgStudioLocaleText } from 'ag-studio';
import type { Locale } from '@/lib/i18n/locales';
import { es } from './es';
import { fr } from './fr';
import { zhCN } from './zh-CN';

const MAPS: Record<Locale, AgStudioLocaleText | undefined> = { en: undefined, es, 'zh-CN': zhCN, fr };

export const studioLocaleText = (locale: string): AgStudioLocaleText | undefined => MAPS[locale as Locale];

// One of AG Studio's labels as Studio shows it in `locale`, so the shell (the guide, the header's
// hint) names Studio's panels and buttons with the same words.
export const studioLabel = (locale: string, key: AgStudioLocaleKey): string =>
  studioLocaleText(locale)?.[key] ?? DEFAULT_LOCALE[key];
