'use server';

import { refresh } from 'next/cache';
import { loadCatalog, type CatalogModel } from '@/lib/settings/catalog';
import { listModels, testPayPal, type ConnectionCheck, type ModelList } from '@/lib/settings/connection';
import { saveSettings, testCredentials, type SaveResult, type SettingsForm } from '@/lib/settings/settings';

export type SaveState = SaveResult | null;

const text = (form: FormData, name: keyof SettingsForm) => String(form.get(name) ?? '');

function settingsForm(form: FormData): SettingsForm {
  return {
    name: text(form, 'name'),
    contactEmails: text(form, 'contactEmails'),
    refundPolicy: text(form, 'refundPolicy'),
    currency: text(form, 'currency'),
    autoRefundUpTo: text(form, 'autoRefundUpTo'),
    approvalUpTo: text(form, 'approvalUpTo'),
    dailyCap: text(form, 'dailyCap'),
    provider: text(form, 'provider'),
    baseUrl: text(form, 'baseUrl'),
    agentModel: text(form, 'agentModel'),
    judgeModel: text(form, 'judgeModel'),
    apiKey: text(form, 'apiKey'),
    clearApiKey: form.get('clearApiKey') === 'on',
    paypalClientId: text(form, 'paypalClientId'),
    paypalSecret: text(form, 'paypalSecret'),
    clearPaypalSecret: form.get('clearPaypalSecret') === 'on',
  };
}

const locked = () => process.env.SETTINGS_LOCKED === 'true';
const LOCKED = 'Settings are read-only on this server (SETTINGS_LOCKED).';

// The proxy's demo password covers these actions, like the page.
export async function saveSettingsAction(_previous: SaveState, form: FormData): Promise<SaveState> {
  const result = await saveSettings(settingsForm(form));
  if (result.ok) refresh();
  return result;
}

// Both tests reach a URL the form names, so a locked (public) server runs neither.
export async function testAiAction(form: FormData): Promise<ModelList> {
  if (locked()) return { ok: false, error: LOCKED };
  const settings = settingsForm(form);
  return listModels({ ...(await testCredentials(settings)).ai, model: settings.agentModel });
}

export async function testPayPalAction(form: FormData): Promise<ConnectionCheck> {
  if (locked()) return { ok: false, error: LOCKED };
  const { paypal } = await testCredentials(settingsForm(form));
  if (!paypal.clientId || !paypal.secret) return { ok: false, error: 'Enter the client ID and secret first.' };
  return testPayPal(paypal);
}

// One provider's models from the catalog, loaded when the owner picks the provider.
export async function catalogModelsAction(providerId: string): Promise<CatalogModel[]> {
  return (await loadCatalog()).models.get(providerId) ?? [];
}
