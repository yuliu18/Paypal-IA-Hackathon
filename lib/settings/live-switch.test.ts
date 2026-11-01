import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { turnOffLiveMode, turnOnLiveMode } from './live-switch';
import { loadSettings, saveSettings, setPaymentMode, type SettingsForm } from './settings';

let dir: string;
let file: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'live-switch-'));
  file = join(dir, 'settings.json');
});
afterEach(() => rm(dir, { recursive: true, force: true }));

const ALLOWED = { SETTINGS_SECRET: 'a-long-settings-secret-for-tests', ALLOW_LIVE_MODE: 'true' };

const form = (changes: Partial<SettingsForm> = {}): SettingsForm => ({
  name: 'Shop', contactEmails: '', refundPolicy: 'Refund damaged orders of the ticket customer.', currency: 'USD',
  autoRefundUpTo: '100', approvalUpTo: '250', dailyCap: '200', provider: 'custom', baseUrl: 'https://llm.example/v1',
  agentModel: 'm', judgeModel: '', apiKey: '', paypalClientId: 'sandbox-id', paypalSecret: 'sandbox-secret',
  paypalLiveClientId: 'live-id', paypalLiveSecret: 'live-secret',
  ...changes,
});

type Call = { url: string; basic: string };
function payPal(status: number) {
  const calls: Call[] = [];
  const fetch = (async (url: string, init: RequestInit = {}) => {
    calls.push({ url, basic: Buffer.from(new Headers(init.headers).get('authorization')!.slice('Basic '.length), 'base64').toString() });
    return status === 200 ? Response.json({ access_token: 't', expires_in: 3600 }) : Response.json({ error: 'invalid_client' }, { status });
  }) as typeof globalThis.fetch;
  return { calls, fetch };
}

const modeOf = async (env: Record<string, string | undefined> = ALLOWED) => (await loadSettings({ file, env })).mode;

describe('turnOnLiveMode', () => {
  it('turns live mode on after a fresh live token request with the saved live app', async () => {
    await saveSettings(form(), { file, env: ALLOWED });
    const paypal = payPal(200);
    expect(await turnOnLiveMode({ confirmation: 'LIVE' }, { settings: { file, env: ALLOWED }, fetch: paypal.fetch })).toEqual({ ok: true });
    expect(paypal.calls).toEqual([{ url: 'https://api-m.paypal.com/v1/oauth2/token', basic: 'live-id:live-secret' }]);
    expect(await modeOf()).toBe('live');
  });

  it.each([undefined, 'false', 'TRUE', '1'])('refuses when ALLOW_LIVE_MODE is %s, before calling PayPal', async (allow) => {
    const env = { ...ALLOWED, ALLOW_LIVE_MODE: allow };
    await saveSettings(form(), { file, env });
    const paypal = payPal(200);
    expect(await turnOnLiveMode({ confirmation: 'LIVE' }, { settings: { file, env }, fetch: paypal.fetch })).toEqual({ ok: false, error: 'server' });
    expect(paypal.calls).toEqual([]);
    expect(await modeOf(env)).toBe('test');
  });

  it('refuses without a saved live app, before calling PayPal', async () => {
    await saveSettings(form({ paypalLiveClientId: '', paypalLiveSecret: '' }), { file, env: ALLOWED });
    const paypal = payPal(200);
    expect(await turnOnLiveMode({ confirmation: 'LIVE' }, { settings: { file, env: ALLOWED }, fetch: paypal.fetch })).toEqual({ ok: false, error: 'app' });
    expect(paypal.calls).toEqual([]);
    expect(await modeOf()).toBe('test');
  });

  it('refuses a live app whose secret was saved with another SETTINGS_SECRET', async () => {
    await saveSettings(form(), { file, env: ALLOWED });
    const other = { ...ALLOWED, SETTINGS_SECRET: 'another-long-settings-secret!!' };
    const paypal = payPal(200);
    expect(await turnOnLiveMode({ confirmation: 'LIVE' }, { settings: { file, env: other }, fetch: paypal.fetch })).toEqual({ ok: false, error: 'app' });
    expect(paypal.calls).toEqual([]);
  });

  it.each(['', 'live', 'Live', 'LIVE!', 'EN VIVO', 'yes'])('refuses the confirmation %j, before calling PayPal', async (confirmation) => {
    await saveSettings(form(), { file, env: ALLOWED });
    const paypal = payPal(200);
    expect(await turnOnLiveMode({ confirmation }, { settings: { file, env: ALLOWED }, fetch: paypal.fetch })).toEqual({ ok: false, error: 'confirmation' });
    expect(paypal.calls).toEqual([]);
    expect(await modeOf()).toBe('test');
  });

  it('accepts the confirmation word with surrounding spaces', async () => {
    await saveSettings(form(), { file, env: ALLOWED });
    expect(await turnOnLiveMode({ confirmation: '  LIVE ' }, { settings: { file, env: ALLOWED }, fetch: payPal(200).fetch })).toEqual({ ok: true });
  });

  it('stays in test mode when live PayPal refuses the credentials, and says so without the secret', async () => {
    await saveSettings(form(), { file, env: ALLOWED });
    const result = await turnOnLiveMode({ confirmation: 'LIVE' }, { settings: { file, env: ALLOWED }, fetch: payPal(401).fetch });
    expect(result).toEqual({ ok: false, error: 'check', detail: 'Live PayPal refused these credentials (401).' });
    expect(JSON.stringify(result)).not.toContain('live-secret');
    expect(await modeOf()).toBe('test');
  });

  it('refuses on a read-only server', async () => {
    await saveSettings(form(), { file, env: ALLOWED });
    const env = { ...ALLOWED, SETTINGS_LOCKED: 'true' };
    const paypal = payPal(200);
    expect(await turnOnLiveMode({ confirmation: 'LIVE' }, { settings: { file, env }, fetch: paypal.fetch })).toEqual({ ok: false, error: 'locked' });
    expect(paypal.calls).toEqual([]);
  });
});

describe('turnOffLiveMode', () => {
  it('is immediate, calls nothing, and works whatever the server flag says', async () => {
    await saveSettings(form(), { file, env: ALLOWED });
    await setPaymentMode('live', { file, env: ALLOWED });
    expect(await turnOffLiveMode({ settings: { file, env: { SETTINGS_SECRET: ALLOWED.SETTINGS_SECRET } } })).toEqual({ ok: true });
    expect(await modeOf()).toBe('test');
  });
});
