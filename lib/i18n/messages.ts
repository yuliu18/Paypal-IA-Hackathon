// The interface's text, one JSON file per area of the app under messages/<locale>/<area>.json, so
// each area can be translated on its own. A message keeps its area as namespace:
// messages/es/nav.json → t('nav.…') / useTranslations('nav').
export const MESSAGE_AREAS = ['common', 'nav', 'settings', 'home', 'desks', 'guard', 'evaluate', 'dashboard', 'auth'] as const;

export type Messages = { [key: string]: string | Messages };

const isGroup = (value: unknown): value is Messages => typeof value === 'object' && value !== null && !Array.isArray(value);

// A translation with every message it lacks (or leaves empty) taken from English, so the page
// shows English rather than a raw key.
export function withFallback(translated: Messages, english: Messages): Messages {
  const merged: Messages = { ...english };
  for (const [key, value] of Object.entries(translated)) {
    const base = english[key];
    if (isGroup(value)) merged[key] = withFallback(value, isGroup(base) ? base : {});
    else if (value !== '') merged[key] = value;
  }
  return merged;
}
