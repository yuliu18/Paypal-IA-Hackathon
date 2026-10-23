import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_REFUND_POLICY, loadSettings, saveSettings, settingsView, type SettingsForm } from './settings';

let dir: string;
let file: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'settings-'));
  file = join(dir, 'data', 'settings.json');
});
afterEach(() => rm(dir, { recursive: true, force: true }));

const SECRET = 'a-long-settings-secret-for-tests';
const ENV = {
  LLM_BASE_URL: 'https://env-llm.example/v1',
  LLM_API_KEY: 'env-llm-key-9999',
  AGENT_MODEL: 'env-agent',
  PAYPAL_CLIENT_ID: 'env-client',
  PAYPAL_SECRET: 'env-paypal-secret-8888',
  SHOP_CONTACT_EMAIL: 'help@shop.example, sales@shop.example',
  SETTINGS_SECRET: SECRET,
};

const form = (changes: Partial<SettingsForm> = {}): SettingsForm => ({
  name: 'Casa Mugs',
  contactEmails: 'hola@casamugs.example',
  refundPolicy: 'Refund damaged or lost orders of the customer who wrote, up to what was paid.',
  currency: 'EUR',
  autoRefundUpTo: '50',
  approvalUpTo: '300.50',
  dailyCap: '500',
  provider: 'deepseek',
  baseUrl: 'https://api.deepseek.com/v1',
  agentModel: 'deepseek-chat',
  judgeModel: '',
  apiKey: 'sk-deepseek-abcd1234',
  paypalClientId: 'shop-client',
  paypalSecret: 'shop-paypal-secret-5678',
  webhookUrl: '',
  ...changes,
});

describe('loadSettings', () => {
  it('uses the environment and the demo defaults when nothing was saved', async () => {
    const settings = await loadSettings({ file, env: ENV });
    expect(settings.business).toEqual({
      name: 'Demo shop',
      contactEmails: ['help@shop.example', 'sales@shop.example'],
      refundPolicy: DEFAULT_REFUND_POLICY,
    });
    expect(settings.limits).toEqual({
      approvalThreshold: { minor: 100_00, currency: 'USD' },
      perRefund: { minor: 250_00, currency: 'USD' },
      daily: { minor: 200_00, currency: 'USD' },
    });
    expect(settings.ai).toEqual({
      provider: 'custom',
      baseUrl: 'https://env-llm.example/v1',
      apiKey: 'env-llm-key-9999',
      // Models are chosen on /settings only: AGENT_MODEL in the environment is ignored.
      agentModel: '',
      judgeModel: '',
    });
    expect(settings.paypal).toEqual({ clientId: 'env-client', secret: 'env-paypal-secret-8888' });
  });

  it('uses what the owner saved, keys included, over the environment', async () => {
    expect(await saveSettings(form(), { file, env: ENV })).toEqual({ ok: true });
    const settings = await loadSettings({ file, env: ENV });
    expect(settings.business).toEqual({
      name: 'Casa Mugs',
      contactEmails: ['hola@casamugs.example'],
      refundPolicy: 'Refund damaged or lost orders of the customer who wrote, up to what was paid.',
    });
    expect(settings.limits).toEqual({
      approvalThreshold: { minor: 50_00, currency: 'EUR' },
      perRefund: { minor: 300_50, currency: 'EUR' },
      daily: { minor: 500_00, currency: 'EUR' },
    });
    expect(settings.ai).toEqual({
      provider: 'deepseek',
      baseUrl: 'https://api.deepseek.com/v1',
      apiKey: 'sk-deepseek-abcd1234',
      agentModel: 'deepseek-chat',
      judgeModel: 'deepseek-chat',
    });
    expect(settings.paypal).toEqual({ clientId: 'shop-client', secret: 'shop-paypal-secret-5678' });
  });

  it('never sends the environment key to a provider URL the owner typed', async () => {
    await saveSettings(form({ baseUrl: 'https://other.example/v1', apiKey: '' }), { file, env: ENV });
    expect((await loadSettings({ file, env: ENV })).ai.apiKey).toBe('');
    await saveSettings(form({ baseUrl: ENV.LLM_BASE_URL, apiKey: '' }), { file, env: ENV });
    expect((await loadSettings({ file, env: ENV })).ai.apiKey).toBe('env-llm-key-9999');
  });

  it('drops a saved key when the provider URL changes without a new key', async () => {
    await saveSettings(form(), { file, env: ENV });
    await saveSettings(form({ baseUrl: 'https://elsewhere.example/v1', apiKey: '' }), { file, env: ENV });
    expect((await loadSettings({ file, env: ENV })).ai.apiKey).toBe('');
  });

  it('never sends the environment PayPal secret with another client id', async () => {
    await saveSettings(form({ paypalSecret: '' }), { file, env: ENV });
    expect((await loadSettings({ file, env: ENV })).paypal).toEqual({ clientId: 'shop-client', secret: '' });
    await saveSettings(form({ paypalClientId: 'env-client', paypalSecret: '' }), { file, env: ENV });
    expect((await loadSettings({ file, env: ENV })).paypal.secret).toBe('env-paypal-secret-8888');
  });
});

describe('saveSettings', () => {
  it('stores keys encrypted, readable only by the server account', async () => {
    await saveSettings(form(), { file, env: ENV });
    const raw = await readFile(file, 'utf8');
    expect(raw).not.toContain('sk-deepseek');
    expect(raw).not.toContain('shop-paypal-secret');
    expect((await stat(file)).mode & 0o777).toBe(0o600);
  });

  it('stores the refund policy with plain line breaks, as browsers send \\r\\n', async () => {
    await saveSettings(form({ refundPolicy: 'Refund damaged orders.\r\nNever refund other customers.' }), { file, env: ENV });
    expect((await loadSettings({ file, env: ENV })).business.refundPolicy).toBe('Refund damaged orders.\nNever refund other customers.');
  });

  it('keeps a saved key when the key field is left blank, and removes it when asked', async () => {
    await saveSettings(form(), { file, env: ENV });
    await saveSettings(form({ apiKey: '', paypalSecret: '' }), { file, env: ENV });
    expect((await loadSettings({ file, env: ENV })).ai.apiKey).toBe('sk-deepseek-abcd1234');
    await saveSettings(form({ apiKey: '', clearApiKey: true, paypalSecret: '', clearPaypalSecret: true }), { file, env: ENV });
    const settings = await loadSettings({ file, env: ENV });
    expect([settings.ai.apiKey, settings.paypal.secret]).toEqual(['', '']);
  });

  it('rejects invalid values field by field and saves nothing', async () => {
    const result = await saveSettings(
      form({
        name: ' ',
        contactEmails: 'hola@casamugs.example, not-an-email',
        refundPolicy: 'short',
        currency: 'euro',
        autoRefundUpTo: '400',
        dailyCap: '-1',
        baseUrl: 'ftp://x',
        agentModel: 'two words',
      }),
      { file, env: ENV },
    );
    expect(result).toEqual({
      ok: false,
      errors: {
        name: 'Enter the business name.',
        contactEmails: 'Not an email: not-an-email',
        refundPolicy: 'Describe the refund policy in at least 20 characters.',
        currency: 'Choose a currency PayPal supports.',
        autoRefundUpTo: 'Automatic refunds must stay within the approval limit.',
        dailyCap: 'Enter an amount above 0 with at most 2 decimals.',
        baseUrl: 'Enter an http(s) URL.',
        agentModel: 'Model ids have no spaces.',
      },
    });
    await expect(stat(file)).rejects.toThrow();
  });

  it('stores keys without SETTINGS_SECRET, encrypted with a generated key file only the server can read', async () => {
    const env = { ...ENV, SETTINGS_SECRET: undefined };
    expect(await saveSettings(form(), { file, env })).toEqual({ ok: true });
    const keyFile = join(dir, 'data', 'settings.key');
    expect((await stat(keyFile)).mode & 0o777).toBe(0o600);
    expect(await readFile(file, 'utf8')).not.toContain('sk-deepseek');
    await saveSettings(form({ apiKey: '', paypalSecret: '' }), { file, env });
    const settings = await loadSettings({ file, env });
    expect([settings.ai.apiKey, settings.paypal.secret]).toEqual(['sk-deepseek-abcd1234', 'shop-paypal-secret-5678']);
    expect((await settingsView({ file, env })).canStoreKeys).toBe(true);
  });

  it('replaces an empty key file, which can hold no saved key, when a key is saved', async () => {
    const env = { ...ENV, SETTINGS_SECRET: undefined };
    await mkdir(join(dir, 'data'), { recursive: true });
    await writeFile(join(dir, 'data', 'settings.key'), '');
    expect(await saveSettings(form(), { file, env })).toEqual({ ok: true });
    expect((await loadSettings({ file, env })).ai.apiKey).toBe('sk-deepseek-abcd1234');
  });

  it('answers with a form error, not a crash, when the key file cannot be read', async () => {
    const env = { ...ENV, SETTINGS_SECRET: undefined };
    await mkdir(join(dir, 'data', 'settings.key'), { recursive: true });
    expect(await saveSettings(form(), { file, env })).toEqual({
      ok: false,
      errors: { form: 'Keys cannot be stored: settings.key, next to the settings file, is unreadable or empty. Delete it and save again.' },
    });
  });

  it('writes no key file when no key is saved', async () => {
    await saveSettings(form({ apiKey: '', paypalSecret: '' }), { file, env: { ...ENV, SETTINGS_SECRET: undefined } });
    await expect(stat(join(dir, 'data', 'settings.key'))).rejects.toThrow();
  });

  it('saves twice at the same time without failing', async () => {
    const results = await Promise.all([saveSettings(form(), { file, env: ENV }), saveSettings(form({ name: 'Other' }), { file, env: ENV })]);
    expect(results).toEqual([{ ok: true }, { ok: true }]);
  });

  it('refuses keys with control characters, which could not be sent as a header', async () => {
    expect(await saveSettings(form({ apiKey: 'sk-ab\ncd', paypalSecret: 'se\u0000cret' }), { file, env: ENV })).toEqual({
      ok: false,
      errors: { apiKey: 'Paste the key without spaces or line breaks.', paypalSecret: 'Paste the key without spaces or line breaks.' },
    });
  });

  it('accepts a URL typed in capitals and asks for the client ID that goes with a secret', async () => {
    expect(await saveSettings(form({ baseUrl: 'HTTPS://api.deepseek.com/v1' }), { file, env: ENV })).toEqual({ ok: true });
    expect(await saveSettings(form({ paypalClientId: '' }), { file, env: ENV })).toEqual({
      ok: false,
      errors: { paypalClientId: 'Enter the client ID that goes with this secret.' },
    });
  });

  it('takes whole amounts only in currencies without decimals, like JPY', async () => {
    expect(await saveSettings(form({ currency: 'JPY', autoRefundUpTo: '5000.50', approvalUpTo: '20000', dailyCap: '30000' }), { file, env: ENV })).toEqual({
      ok: false,
      errors: { autoRefundUpTo: 'JPY has no decimals: enter a whole amount.' },
    });
    expect(await saveSettings(form({ currency: 'JPY', autoRefundUpTo: '5000', approvalUpTo: '20000', dailyCap: '30000' }), { file, env: ENV })).toEqual({ ok: true });
    expect((await loadSettings({ file, env: ENV })).limits.approvalThreshold).toEqual({ minor: 5000_00, currency: 'JPY' });
    expect((await settingsView({ file, env: ENV })).form).toMatchObject({ autoRefundUpTo: '5000', approvalUpTo: '20000', dailyCap: '30000' });
  });

  it('saves no agent model to mean the provider default', async () => {
    expect(await saveSettings(form({ agentModel: '', judgeModel: '' }), { file, env: ENV })).toEqual({ ok: true });
    expect((await loadSettings({ file, env: ENV })).ai).toMatchObject({ agentModel: '', judgeModel: '' });
  });

  it('changes nothing when the settings are locked', async () => {
    const env = { ...ENV, SETTINGS_LOCKED: 'true' };
    expect(await saveSettings(form(), { file, env })).toEqual({
      ok: false,
      errors: { form: 'Settings are read-only on this server (SETTINGS_LOCKED).' },
    });
    await expect(stat(file)).rejects.toThrow();
  });
});

describe('reading the settings file', () => {
  it('ignores a section with the wrong shape and keeps the rest', async () => {
    await saveSettings(form(), { file, env: ENV });
    const saved = JSON.parse(await readFile(file, 'utf8'));
    await writeFile(file, JSON.stringify({ ...saved, limits: { currency: 'EUR', autoRefundUpTo: '50' } }));
    const settings = await loadSettings({ file, env: ENV });
    expect(settings.limits.approvalThreshold).toEqual({ minor: 100_00, currency: 'USD' });
    expect(settings.business.name).toBe('Casa Mugs');
  });
});

describe('settingsView', () => {
  it('shows only the last 4 characters of each key and where it comes from', async () => {
    const before = await settingsView({ file, env: ENV });
    expect(before.ai.apiKey).toEqual({ source: 'env', hint: '••••9999' });
    expect(before.paypal.secret).toEqual({ source: 'env', hint: '••••8888' });
    expect(before.form).toMatchObject({ baseUrl: ENV.LLM_BASE_URL, apiKey: '', paypalSecret: '', autoRefundUpTo: '100.00' });
    expect([before.locked, before.canStoreKeys]).toEqual([false, true]);

    await saveSettings(form(), { file, env: ENV });
    const after = await settingsView({ file, env: { ...ENV, SETTINGS_LOCKED: 'true' } });
    expect(after.ai.apiKey).toEqual({ source: 'saved', hint: '••••1234' });
    expect(after.paypal.secret).toEqual({ source: 'saved', hint: '••••5678' });
    expect(JSON.stringify(after)).not.toContain('sk-deepseek');
    expect(after.locked).toBe(true);
  });

  it('says when a saved key can no longer be read because SETTINGS_SECRET changed', async () => {
    await saveSettings(form(), { file, env: ENV });
    const env = { ...ENV, SETTINGS_SECRET: 'a-different-settings-secret' };
    expect((await settingsView({ file, env })).ai.apiKey).toEqual({ source: 'unreadable', hint: '' });
    expect((await loadSettings({ file, env })).ai.apiKey).toBe('');
  });
});

describe('retired model variables', () => {
  it('warns once in the server log that AGENT_MODEL and JUDGE_MODEL are ignored now', async () => {
    const { vi } = await import('vitest');
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    await loadSettings({ file, env: { ...ENV, JUDGE_MODEL: 'old-judge' } });
    await loadSettings({ file, env: { ...ENV, JUDGE_MODEL: 'old-judge' } });
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith('AGENT_MODEL and JUDGE_MODEL are no longer read: choose the models on /settings (until then the provider default runs).');
    warn.mockRestore();
  });
});

describe('held-refund webhook', () => {
  const WEBHOOK = 'https://hooks.slack.example/services/T000/B000/token-wxyz';

  it('stores the webhook URL encrypted and gives it back to the server', async () => {
    expect(await saveSettings(form({ webhookUrl: `  ${WEBHOOK} ` }), { file, env: ENV })).toEqual({ ok: true });
    const raw = await readFile(file, 'utf8');
    expect(raw).not.toContain('hooks.slack.example');
    expect(raw).not.toContain('token-wxyz');
    expect((await loadSettings({ file, env: ENV })).notifications).toEqual({ webhookUrl: WEBHOOK });
  });

  it('keeps the saved URL when the field is left blank, and removes it when asked', async () => {
    await saveSettings(form({ webhookUrl: WEBHOOK }), { file, env: ENV });
    await saveSettings(form({ webhookUrl: '' }), { file, env: ENV });
    expect((await loadSettings({ file, env: ENV })).notifications.webhookUrl).toBe(WEBHOOK);
    await saveSettings(form({ webhookUrl: '', clearWebhookUrl: true }), { file, env: ENV });
    expect((await loadSettings({ file, env: ENV })).notifications.webhookUrl).toBe('');
  });

  it('takes only an https URL without spaces or control characters', async () => {
    const error = { ok: false, errors: { webhookUrl: 'Enter the https:// webhook URL from Slack or Discord.' } };
    for (const webhookUrl of ['http://hooks.slack.example/x', 'hooks.slack.example/x', 'https://hooks.slack.example/a b', 'https://hooks.slack.example/a\u0000b', 'https://']) {
      expect(await saveSettings(form({ webhookUrl }), { file, env: ENV })).toEqual(error);
    }
    await expect(stat(file)).rejects.toThrow();
  });

  it('falls back to GUARD_WEBHOOK_URL, and a saved URL wins over it', async () => {
    const env = { ...ENV, GUARD_WEBHOOK_URL: 'https://discord.example/api/webhooks/1/env-hook-7777' };
    expect((await loadSettings({ file, env })).notifications.webhookUrl).toBe(env.GUARD_WEBHOOK_URL);
    expect((await loadSettings({ file, env: ENV })).notifications.webhookUrl).toBe('');
    await saveSettings(form({ webhookUrl: WEBHOOK }), { file, env });
    expect((await loadSettings({ file, env })).notifications.webhookUrl).toBe(WEBHOOK);
  });

  it('shows the page only the last 4 characters of the URL and where it comes from', async () => {
    const env = { ...ENV, GUARD_WEBHOOK_URL: 'https://discord.example/api/webhooks/1/env-hook-7777' };
    expect((await settingsView({ file, env: ENV })).notifications.webhookUrl).toEqual({ source: 'none', hint: '' });
    expect((await settingsView({ file, env })).notifications.webhookUrl).toEqual({ source: 'env', hint: '••••7777' });
    await saveSettings(form({ webhookUrl: WEBHOOK }), { file, env });
    const view = await settingsView({ file, env });
    expect(view.notifications.webhookUrl).toEqual({ source: 'saved', hint: '••••wxyz' });
    expect(view.form.webhookUrl).toBe('');
    expect(JSON.stringify(view)).not.toContain('hooks.slack.example');
  });

  it('stores the URL without SETTINGS_SECRET using the generated key file', async () => {
    const env = { ...ENV, SETTINGS_SECRET: undefined };
    expect(await saveSettings(form({ apiKey: '', paypalSecret: '', webhookUrl: WEBHOOK }), { file, env })).toEqual({ ok: true });
    expect((await stat(join(dir, 'data', 'settings.key'))).mode & 0o777).toBe(0o600);
    expect((await loadSettings({ file, env })).notifications.webhookUrl).toBe(WEBHOOK);
  });

  it('leaves the AI key and PayPal secret keep-and-clear as before', async () => {
    await saveSettings(form({ webhookUrl: WEBHOOK }), { file, env: ENV });
    await saveSettings(form({ apiKey: '', paypalSecret: '', clearWebhookUrl: true }), { file, env: ENV });
    expect((await loadSettings({ file, env: ENV })).paypal.secret).toBe('shop-paypal-secret-5678');
    expect((await loadSettings({ file, env: ENV })).ai.apiKey).toBe('sk-deepseek-abcd1234');
    await saveSettings(form({ apiKey: '', paypalSecret: '', clearPaypalSecret: true }), { file, env: ENV });
    expect((await loadSettings({ file, env: ENV })).paypal.secret).toBe('');
  });
});
