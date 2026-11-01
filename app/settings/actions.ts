'use server';

import { refresh } from 'next/cache';
import { getTranslations } from 'next-intl/server';
import { loadCatalog, withDefaultModels, type CatalogModel } from '@/lib/settings/catalog';
import { listModels, testPayPal, type ConnectionCheck, type ModelList } from '@/lib/settings/connection';
import { saveSettings, testCredentials, testLiveCredentials, type SaveResult, type SettingsForm } from '@/lib/settings/settings';

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
    paypalLiveClientId: text(form, 'paypalLiveClientId'),
    paypalLiveSecret: text(form, 'paypalLiveSecret'),
    clearPaypalLiveSecret: form.get('clearPaypalLiveSecret') === 'on',
    webhookUrl: text(form, 'webhookUrl'),
    clearWebhookUrl: form.get('clearWebhookUrl') === 'on',
    resendApiKey: text(form, 'resendApiKey'),
    clearResendApiKey: form.get('clearResendApiKey') === 'on',
    emailFrom: text(form, 'emailFrom'),
    telegramBotToken: text(form, 'telegramBotToken'),
    clearTelegramBotToken: form.get('clearTelegramBotToken') === 'on',
    telegramChatId: text(form, 'telegramChatId'),
    smtpHost: text(form, 'smtpHost'),
    smtpPort: text(form, 'smtpPort'),
    smtpUser: text(form, 'smtpUser'),
    smtpPassword: text(form, 'smtpPassword'),
    clearSmtpPassword: form.get('clearSmtpPassword') === 'on',
  };
}

const locked = () => process.env.SETTINGS_LOCKED === 'true';
const lockedError = async () => (await getTranslations('settings'))('lockedError');

// The proxy's demo password covers these actions, like the page.
export async function saveSettingsAction(_previous: SaveState, form: FormData): Promise<SaveState> {
  const result = await saveSettings(settingsForm(form));
  if (result.ok) refresh();
  return result;
}

// Both tests reach a URL the form names, so a locked (public) server runs neither.
export async function testAiAction(form: FormData): Promise<ModelList> {
  if (locked()) return { ok: false, error: await lockedError() };
  const settings = settingsForm(form);
  const { ai } = await testCredentials(settings);
  const { agentModel } = await withDefaultModels({ ...ai, provider: settings.provider, agentModel: settings.agentModel, judgeModel: '' });
  return listModels({ ...ai, model: agentModel });
}

export async function testPayPalAction(form: FormData): Promise<ConnectionCheck> {
  if (locked()) return { ok: false, error: await lockedError() };
  const { paypal } = await testCredentials(settingsForm(form));
  if (!paypal.clientId || !paypal.secret) return { ok: false, error: (await getTranslations('settings'))('paypal.needCredentials') };
  return testPayPal(paypal);
}

// The live app's credentials against live PayPal (api-m.paypal.com): one token request, nothing else.
export async function testLivePayPalAction(form: FormData): Promise<ConnectionCheck> {
  if (locked()) return { ok: false, error: await lockedError() };
  const live = await testLiveCredentials(settingsForm(form));
  if (!live.clientId || !live.secret) return { ok: false, error: (await getTranslations('settings'))('paypal.needCredentials') };
  return testPayPal(live, fetch, 'live');
}

// One provider's models from the catalog, loaded when the owner picks the provider.
export async function catalogModelsAction(providerId: string): Promise<CatalogModel[]> {
  return (await loadCatalog()).models.get(providerId) ?? [];
}
