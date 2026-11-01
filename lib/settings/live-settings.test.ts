import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadSettings, saveSettings, setPaymentMode, settingsView, type SettingsForm } from './settings';

let dir: string;
let file: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'live-settings-'));
  file = join(dir, 'data', 'settings.json');
});
afterEach(() => rm(dir, { recursive: true, force: true }));

const env = { SETTINGS_SECRET: 'a-long-settings-secret-for-tests' };

const form = (changes: Partial<SettingsForm> = {}): SettingsForm => ({
  name: 'Casa Mugs',
  contactEmails: 'hola@casamugs.example',
  refundPolicy: 'Refund damaged or lost orders of the customer who wrote, up to what was paid.',
  currency: 'USD',
  autoRefundUpTo: '50',
  approvalUpTo: '300',
  dailyCap: '500',
  provider: 'custom',
  baseUrl: 'https://llm.example/v1',
  agentModel: 'm',
  judgeModel: '',
  apiKey: '',
  paypalClientId: 'sandbox-id',
  paypalSecret: 'sandbox-secret-1234',
  ...changes,
});

describe('settings from before live mode', () => {
  it('load as test mode with no live app, keeping the sandbox app', async () => {
    await mkdir(dirname(file), { recursive: true });
    // Written by the previous version: no paypalLive, no mode.
    await saveSettings(form(), { file, env });
    const saved = JSON.parse(await readFile(file, 'utf8'));
    delete saved.paypalLive;
    delete saved.paypalMode;
    await writeFile(file, JSON.stringify(saved));

    const settings = await loadSettings({ file, env });
    expect(settings.mode).toBe('test');
    expect(settings.paypalLive).toEqual({ clientId: '', secret: '' });
    expect(settings.paypal).toEqual({ clientId: 'sandbox-id', secret: 'sandbox-secret-1234' });
  });

  it('a form without the live fields keeps the saved live app', async () => {
    await saveSettings(form({ paypalLiveClientId: 'live-id', paypalLiveSecret: 'live-secret-9876' }), { file, env });
    await saveSettings(form({ name: 'Renamed' }), { file, env });
    expect((await loadSettings({ file, env })).paypalLive).toEqual({ clientId: 'live-id', secret: 'live-secret-9876' });
  });
});

describe('the live app', () => {
  it('is saved sealed, like the sandbox secret, and read back', async () => {
    await saveSettings(form({ paypalLiveClientId: 'live-id', paypalLiveSecret: 'live-secret-9876' }), { file, env });
    expect(await readFile(file, 'utf8')).not.toContain('live-secret-9876');
    expect((await loadSettings({ file, env })).paypalLive).toEqual({ clientId: 'live-id', secret: 'live-secret-9876' });
    const view = await settingsView({ file, env });
    expect(view.form.paypalLiveClientId).toBe('live-id');
    expect(view.form.paypalLiveSecret).toBe('');
    expect(view.paypalLive.secret).toEqual({ source: 'saved', hint: '••••9876' });
  });

  it('never falls back to the environment or the sandbox secret', async () => {
    await saveSettings(form({ paypalLiveClientId: 'live-id' }), { file, env: { ...env, PAYPAL_SECRET: 'env-secret', PAYPAL_CLIENT_ID: 'live-id' } });
    expect((await loadSettings({ file, env: { ...env, PAYPAL_SECRET: 'env-secret', PAYPAL_CLIENT_ID: 'live-id' } })).paypalLive).toEqual({ clientId: 'live-id', secret: '' });
  });

  it('needs a client id with its secret', async () => {
    const result = await saveSettings(form({ paypalLiveSecret: 'live-secret-9876' }), { file, env });
    expect(result).toEqual({ ok: false, errors: { paypalLiveClientId: 'Enter the client ID that goes with this secret.' } });
  });

  it('can have its secret removed', async () => {
    await saveSettings(form({ paypalLiveClientId: 'live-id', paypalLiveSecret: 'live-secret-9876' }), { file, env });
    await saveSettings(form({ paypalLiveClientId: 'live-id', clearPaypalLiveSecret: true }), { file, env });
    expect((await loadSettings({ file, env })).paypalLive.secret).toBe('');
  });
});

describe('setPaymentMode', () => {
  it('saves the mode on its own and keeps everything else', async () => {
    await saveSettings(form({ paypalLiveClientId: 'live-id', paypalLiveSecret: 'live-secret-9876' }), { file, env });
    expect(await setPaymentMode('live', { file, env })).toEqual({ ok: true });
    const settings = await loadSettings({ file, env });
    expect(settings.mode).toBe('live');
    expect(settings.business.name).toBe('Casa Mugs');
    expect(settings.paypalLive.secret).toBe('live-secret-9876');
    expect(await setPaymentMode('test', { file, env })).toEqual({ ok: true });
    expect((await loadSettings({ file, env })).mode).toBe('test');
  });

  it('the big form never changes the mode', async () => {
    await saveSettings(form({ paypalLiveClientId: 'live-id', paypalLiveSecret: 'live-secret-9876' }), { file, env });
    await setPaymentMode('live', { file, env });
    await saveSettings(form({ name: 'Renamed' }), { file, env });
    expect((await loadSettings({ file, env })).mode).toBe('live');
  });

  it('changing the live app turns live mode off, so a new app is checked before it moves money', async () => {
    await saveSettings(form({ paypalLiveClientId: 'live-id', paypalLiveSecret: 'live-secret-9876' }), { file, env });
    await setPaymentMode('live', { file, env });
    await saveSettings(form({ paypalLiveClientId: 'live-id', paypalLiveSecret: 'another-secret-1111' }), { file, env });
    expect((await loadSettings({ file, env })).mode).toBe('test');

    await setPaymentMode('live', { file, env });
    await saveSettings(form({ paypalLiveClientId: 'other-live-id', paypalLiveSecret: 'another-secret-1111' }), { file, env });
    expect((await loadSettings({ file, env })).mode).toBe('test');

    await saveSettings(form({ paypalLiveClientId: 'other-live-id', paypalLiveSecret: 'another-secret-1111' }), { file, env });
    await setPaymentMode('live', { file, env });
    await saveSettings(form({ paypalLiveClientId: 'other-live-id', clearPaypalLiveSecret: true }), { file, env });
    expect((await loadSettings({ file, env })).mode).toBe('test');
  });

  it('turns live on only on a server that is not read-only, but always turns it off', async () => {
    await saveSettings(form({ paypalLiveClientId: 'live-id', paypalLiveSecret: 'live-secret-9876' }), { file, env });
    await setPaymentMode('live', { file, env });
    const locked = { ...env, SETTINGS_LOCKED: 'true' };
    expect(await setPaymentMode('live', { file, env: locked })).toEqual({ ok: false, error: 'locked' });
    expect(await setPaymentMode('test', { file, env: locked })).toEqual({ ok: true });
    expect((await loadSettings({ file, env })).mode).toBe('test');
  });

  it('reads a stored mode in the wrong shape as test mode', async () => {
    await saveSettings(form(), { file, env });
    const saved = JSON.parse(await readFile(file, 'utf8'));
    await writeFile(file, JSON.stringify({ ...saved, paypalMode: { mode: 'LIVE' } }));
    expect((await loadSettings({ file, env })).mode).toBe('test');
  });
});

describe('setPaymentMode on a store it cannot read', () => {
  it('writes nothing over a file that is not JSON', async () => {
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, '{ not json');
    expect(await setPaymentMode('test', { file, env })).toEqual({ ok: false, error: 'unreadable' });
    expect(await readFile(file, 'utf8')).toBe('{ not json');
  });
});
