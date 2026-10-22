import type { Metadata } from 'next';
import { connection } from 'next/server';
import { loadCatalog } from '@/lib/settings/catalog';
import { settingsView } from '@/lib/settings/settings';
import { SettingsEditor } from './settings-editor';

export const metadata: Metadata = { title: 'Settings' };

export default async function SettingsPage() {
  await connection();
  const [view, catalog] = await Promise.all([settingsView(), loadCatalog()]);
  return <SettingsEditor view={view} providers={catalog.providers} initialModels={catalog.models.get(view.form.provider) ?? []} />;
}
