import { describe, expect, it } from 'vitest';
import { authMode } from './config';

const secret = 'x'.repeat(32);

describe('authMode', () => {
  it('uses the built-in owner accounts when Neon Auth is not configured, with or without a database', () => {
    expect(authMode({})).toEqual({ kind: 'local' });
    expect(authMode({ NEON_AUTH_BASE_URL: '', DATABASE_URL: 'postgres://db' })).toEqual({ kind: 'local' });
    expect(authMode({ DEMO_PASSWORD: 'anything' })).toEqual({ kind: 'local' });
  });

  it('uses the owner login when Neon Auth, its cookie secret and the database are configured', () => {
    expect(authMode({ NEON_AUTH_BASE_URL: 'https://auth.example/neondb/auth', NEON_AUTH_COOKIE_SECRET: secret, DATABASE_URL: 'postgres://db' })).toEqual({
      kind: 'neon',
      baseUrl: 'https://auth.example/neondb/auth',
      cookieSecret: secret,
    });
  });

  it('refuses to run half configured: Neon Auth without a 32-character cookie secret or a database', () => {
    expect(authMode({ NEON_AUTH_BASE_URL: 'https://auth.example', DATABASE_URL: 'postgres://db' })).toEqual({
      kind: 'misconfigured',
      missing: ['NEON_AUTH_COOKIE_SECRET'],
    });
    expect(authMode({ NEON_AUTH_BASE_URL: 'https://auth.example', NEON_AUTH_COOKIE_SECRET: 'short', DATABASE_URL: 'postgres://db' })).toEqual({
      kind: 'misconfigured',
      missing: ['NEON_AUTH_COOKIE_SECRET'],
    });
    expect(authMode({ NEON_AUTH_BASE_URL: 'https://auth.example' })).toEqual({
      kind: 'misconfigured',
      missing: ['NEON_AUTH_COOKIE_SECRET', 'DATABASE_URL'],
    });
  });
});
