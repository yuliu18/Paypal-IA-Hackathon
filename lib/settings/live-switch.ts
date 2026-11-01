// The Test / Live switch on /settings. Turning live mode on is guarded, in this order: the server
// is not read-only, it allows live mode (ALLOW_LIVE_MODE=true; the public demo leaves it unset),
// the live app's credentials are saved and readable, the owner typed the confirmation word, and a
// fresh token request to live PayPal with those credentials succeeds. Nothing calls PayPal before
// the earlier checks pass. Turning it off is immediate and always allowed. Server-side only.

import { testPayPal } from './connection.ts';
import { hasLiveApp, LIVE_CONFIRMATION_WORD, liveAllowedByServer } from './live-mode.ts';
import { loadSettings, setPaymentMode, type SettingsOptions } from './settings.ts';

export type LiveSwitchError = 'locked' | 'server' | 'app' | 'confirmation' | 'check' | 'unreadable';
export type LiveSwitchResult = { ok: true } | { ok: false; error: LiveSwitchError; detail?: string };

type Options = { settings?: SettingsOptions; fetch?: typeof globalThis.fetch };

export async function turnOnLiveMode({ confirmation }: { confirmation: string }, { settings: options = {}, fetch = globalThis.fetch }: Options = {}): Promise<LiveSwitchResult> {
  const env = options.env ?? process.env;
  if (env.SETTINGS_LOCKED === 'true') return { ok: false, error: 'locked' };
  if (!liveAllowedByServer(env)) return { ok: false, error: 'server' };
  const settings = await loadSettings(options);
  if (!hasLiveApp(settings)) return { ok: false, error: 'app' };
  if (confirmation.trim() !== LIVE_CONFIRMATION_WORD) return { ok: false, error: 'confirmation' };
  const check = await testPayPal(settings.paypalLive, fetch, 'live');
  if (!check.ok) return { ok: false, error: 'check', detail: check.error };
  const saved = await setPaymentMode('live', options);
  return saved.ok ? { ok: true } : { ok: false, error: saved.error };
}

export async function turnOffLiveMode({ settings: options = {} }: Pick<Options, 'settings'> = {}): Promise<LiveSwitchResult> {
  const saved = await setPaymentMode('test', options);
  return saved.ok ? { ok: true } : { ok: false, error: saved.error };
}
