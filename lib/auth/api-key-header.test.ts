import { describe, expect, it } from 'vitest';
import { API_KEY_AUTH_HEADER, apiKeyIdFrom } from './api-key-header';

describe('apiKeyIdFrom', () => {
  it('reads the key id the proxy put in x-pg-auth', () => {
    expect(API_KEY_AUTH_HEADER).toBe('x-pg-auth');
    expect(apiKeyIdFrom(new Headers({ 'x-pg-auth': 'api-key:1b4e28ba-2fa1-11d2-883f-0016d3cca427' }))).toBe('1b4e28ba-2fa1-11d2-883f-0016d3cca427');
  });

  it('is null for a request signed in another way', () => {
    expect(apiKeyIdFrom(new Headers())).toBeNull();
    expect(apiKeyIdFrom(new Headers({ 'x-pg-auth': 'session' }))).toBeNull();
    expect(apiKeyIdFrom(new Headers({ 'x-pg-auth': 'api-key:' }))).toBeNull();
  });
});
