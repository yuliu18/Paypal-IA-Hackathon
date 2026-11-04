import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { connection } from 'next/server';
import { getTranslations } from 'next-intl/server';
import { loadCatalog } from '@/lib/settings/catalog';
import { liveModeStatus } from '@/lib/settings/live-mode';
import { loadSettings, settingsView } from '@/lib/settings/settings';
import { SettingsEditor } from './settings-editor';

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations('settings'))('title') };
}

export default async function SettingsPage({ searchParams }: { searchParams: Promise<{ section?: string | string[] }> }) {
  // The API keys moved to the API page, next to the API they open.
  if ((await searchParams).section === 'api-keys') redirect('/api-docs');
  await connection();
  const [view, catalog, settings] = await Promise.all([settingsView(), loadCatalog(), loadSettings()]);
  return (
    <SettingsEditor
      view={view}
      providers={catalog.providers}
      initialModels={catalog.models.get(view.form.provider) ?? []}
      // Re-checked on every visit, like every request: what is really in force, and why not when it isn't.
      liveMode={liveModeStatus(settings)}
    />
  );
}
