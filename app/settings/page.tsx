import type { Metadata } from 'next';
import { connection } from 'next/server';
import { PROVIDERS } from '@/lib/settings/providers';
import { settingsView } from '@/lib/settings/settings';
import { SettingsEditor } from './settings-editor';

export const metadata: Metadata = { title: 'Settings' };

export default async function SettingsPage() {
  await connection();
  return <SettingsEditor view={await settingsView()} providers={PROVIDERS} />;
}
