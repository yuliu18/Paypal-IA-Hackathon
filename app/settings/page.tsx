import type { Metadata } from 'next';
import { connection } from 'next/server';
import { getTranslations } from 'next-intl/server';
import { apiKeys } from '@/lib/apikeys/keys';
import { loadCatalog } from '@/lib/settings/catalog';
import { liveModeStatus } from '@/lib/settings/live-mode';
import { loadSettings, settingsView } from '@/lib/settings/settings';
import type { ApiKeysView } from './api-keys-section';
import { SettingsEditor } from './settings-editor';

// The API keys for their section: none without DATABASE_URL; an unreachable database only greys
// out that section, never the page.
async function apiKeysView(): Promise<ApiKeysView> {
  try {
    const listed = await (await apiKeys()).list();
    return listed.ok ? { state: 'ready', keys: listed.keys } : { state: 'unavailable' };
  } catch (error) {
    console.error('The API keys could not be read', error);
    return { state: 'unreadable' };
  }
}

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations('settings'))('title') };
}

export default async function SettingsPage() {
  await connection();
  const [view, catalog, keys, settings] = await Promise.all([settingsView(), loadCatalog(), apiKeysView(), loadSettings()]);
  return (
    <SettingsEditor
      view={view}
      providers={catalog.providers}
      initialModels={catalog.models.get(view.form.provider) ?? []}
      apiKeys={keys}
      // Re-checked on every visit, like every request: what is really in force, and why not when it isn't.
      liveMode={liveModeStatus(settings)}
    />
  );
}
