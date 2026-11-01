import { describe, expect, it } from 'vitest';
import { liveModeStatus, paymentEnvironment } from './live-mode';

const LIVE_APP = { clientId: 'live-id', secret: 'live-secret' };
const NO_APP = { clientId: '', secret: '' };

describe('paymentEnvironment', () => {
  // Every combination of the four conditions: live only when all four hold.
  const cases = [];
  for (const mode of ['test', 'live'] as const)
    for (const allow of [undefined, 'false', 'true'])
      for (const apiKeyId of [null, 'key-1'])
        for (const app of [NO_APP, { clientId: 'live-id', secret: '' }, LIVE_APP]) cases.push({ mode, allow, apiKeyId, app });

  it.each(cases)('mode $mode, ALLOW_LIVE_MODE $allow, api key $apiKeyId, live app $app.clientId/$app.secret', ({ mode, allow, apiKeyId, app }) => {
    const expected = mode === 'live' && allow === 'true' && apiKeyId !== null && app === LIVE_APP ? 'live' : 'sandbox';
    expect(paymentEnvironment({ settings: { mode, paypalLive: app }, env: { ALLOW_LIVE_MODE: allow }, apiKeyId })).toBe(expected);
  });

  it('accepts only the exact string "true" as the server flag', () => {
    for (const allow of ['TRUE', '1', 'yes', ' true', 'true ']) {
      expect(paymentEnvironment({ settings: { mode: 'live', paypalLive: LIVE_APP }, env: { ALLOW_LIVE_MODE: allow }, apiKeyId: 'key-1' })).toBe('sandbox');
    }
  });

  it('treats an empty api key id as no api key', () => {
    expect(paymentEnvironment({ settings: { mode: 'live', paypalLive: LIVE_APP }, env: { ALLOW_LIVE_MODE: 'true' }, apiKeyId: '' })).toBe('sandbox');
  });

  it('treats any mode other than "live" as test mode', () => {
    const settings = { mode: 'LIVE' as unknown as 'live', paypalLive: LIVE_APP };
    expect(paymentEnvironment({ settings, env: { ALLOW_LIVE_MODE: 'true' }, apiKeyId: 'key-1' })).toBe('sandbox');
  });
});

describe('liveModeStatus', () => {
  it('is active only when the owner turned it on, the server allows it and the live app is saved', () => {
    expect(liveModeStatus({ mode: 'live', paypalLive: LIVE_APP }, { ALLOW_LIVE_MODE: 'true' })).toEqual({ mode: 'live', serverAllows: true, liveApp: true, active: true });
  });

  it('falls back to test mode and says why when the server flag is gone', () => {
    expect(liveModeStatus({ mode: 'live', paypalLive: LIVE_APP }, {})).toEqual({ mode: 'live', serverAllows: false, liveApp: true, active: false });
  });

  it('falls back to test mode and says why when the live app is missing', () => {
    expect(liveModeStatus({ mode: 'live', paypalLive: NO_APP }, { ALLOW_LIVE_MODE: 'true' })).toEqual({ mode: 'live', serverAllows: true, liveApp: false, active: false });
  });

  it('is off in test mode whatever else holds', () => {
    expect(liveModeStatus({ mode: 'test', paypalLive: LIVE_APP }, { ALLOW_LIVE_MODE: 'true' }).active).toBe(false);
  });
});
