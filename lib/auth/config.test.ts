import { describe, expect, it } from 'vitest';
import { authMode } from './config';

const secret = 'x'.repeat(32);

describe('authMode', () => {
  it('uses the demo password when Neon Auth is not configured', () => {
    expect(authMode({})).toEqual({ kind: 'demo' });
    expect(authMode({ NEON_AUTH_BASE_URL: '', DATABASE_URL: 'postgres://db' })).toEqual({ kind: 'demo' });
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
