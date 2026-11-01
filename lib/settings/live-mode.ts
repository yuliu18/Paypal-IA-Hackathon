// Live mode: whether a request may use the shop's live PayPal app (real money) or must stay on the
// sandbox. One decision for the whole app, re-checked on every request, failing closed to the
// sandbox: live only when the owner turned it on, the server allows it (ALLOW_LIVE_MODE=true; the
// public demo leaves it unset), the live app's credentials are saved and readable, and the request
// came in with an API key (the shop's own app). The test pages, the evaluation and the sample data
// never send one, so they always use the sandbox. Server-side only.

import { apiKeyIdFrom } from '../auth/api-key-header.ts';
import type { PaymentEnvironment } from '../guard/ports.ts';
import { loadSettings, type SettingsOptions, type ShopSettings } from './settings.ts';

type Env = Record<string, string | undefined>;

// The word the owner types to confirm turning live mode on; never translated.
export const LIVE_CONFIRMATION_WORD = 'LIVE';

export const liveAllowedByServer = (env: Env) => env.ALLOW_LIVE_MODE === 'true';

export const hasLiveApp = ({ paypalLive }: Pick<ShopSettings, 'paypalLive'>) => Boolean(paypalLive.clientId && paypalLive.secret);

// `mode`: what the owner chose; `active`: whether live mode is really on now.
export type LiveModeStatus = { mode: 'test' | 'live'; serverAllows: boolean; liveApp: boolean; active: boolean };

export function liveModeStatus(settings: Pick<ShopSettings, 'mode' | 'paypalLive'>, env: Env = process.env): LiveModeStatus {
  const mode = settings.mode === 'live' ? 'live' : 'test';
  const serverAllows = liveAllowedByServer(env);
  const liveApp = hasLiveApp(settings);
  return { mode, serverAllows, liveApp, active: mode === 'live' && serverAllows && liveApp };
}

// The PayPal environment one request runs in. `apiKeyId`: the API key it came in with
// (lib/auth/api-key-header.ts apiKeyIdFrom), null for the owner's session or the demo password.
export function paymentEnvironment({
  settings,
  env = process.env,
  apiKeyId,
}: {
  settings: Pick<ShopSettings, 'mode' | 'paypalLive'>;
  env?: Env;
  apiKeyId: string | null;
}): PaymentEnvironment {
  return liveModeStatus(settings, env).active && typeof apiKeyId === 'string' && apiKeyId.length > 0 ? 'live' : 'sandbox';
}

// The environment for an incoming request to one of the agent routes, from its headers.
export async function requestEnvironment(headers: Headers, options: SettingsOptions = {}): Promise<PaymentEnvironment> {
  const apiKeyId = apiKeyIdFrom(headers);
  // Without an API key nothing more needs reading: the answer is the sandbox.
  if (!apiKeyId) return 'sandbox';
  return paymentEnvironment({ settings: await loadSettings(options), env: options.env ?? process.env, apiKeyId });
}
