import type { Metadata } from 'next';
import { connection } from 'next/server';
import { getTranslations } from 'next-intl/server';
import { loadCatalog } from '@/lib/settings/catalog';
import { settingsView } from '@/lib/settings/settings';
import { SettingsEditor } from './settings-editor';

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations('settings'))('title') };
}

export default async function SettingsPage() {
  await connection();
  const [view, catalog] = await Promise.all([settingsView(), loadCatalog()]);
  return <SettingsEditor view={view} providers={catalog.providers} initialModels={catalog.models.get(view.form.provider) ?? []} />;
}
