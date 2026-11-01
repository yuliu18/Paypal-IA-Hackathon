import { NextRequest, NextResponse } from 'next/server';
import { describe, expect, it, vi } from 'vitest';
import type { AuthMode } from './config';
import { gate, type GateDeps } from './gate';

const neon: AuthMode = { kind: 'neon', baseUrl: 'https://auth.example/neondb/auth', cookieSecret: 'x'.repeat(32) };
const request = (path: string, init: { method?: string; headers?: Record<string, string> } = {}) =>
  new NextRequest(`https://guard.example${path}`, init);

const deps = (overrides: Partial<GateDeps> = {}): GateDeps => ({
  mode: neon,
  demo: () => new NextResponse('demo', { status: 401 }),
  session: async () => ({ userId: undefined, cookies: [] }),
  ownerId: async () => 'owner-1',
  ...overrides,
});

const passedThrough = (response: Response) => response.headers.get('x-middleware-next') === '1';

describe('gate without Neon Auth (demo password)', () => {
  it('leaves every request, the login page included, to the demo password unchanged', async () => {
    const demo = vi.fn(() => new NextResponse('Authentication required.', { status: 401 }));
    for (const path of ['/', '/login', '/api/guard/export', '/api/auth/sign-in']) {
      const response = await gate(request(path), deps({ mode: { kind: 'demo' }, demo }));
      expect(response.status).toBe(401);
    }
    expect(demo).toHaveBeenCalledTimes(4);
  });
});

describe('gate half configured', () => {
  it('refuses every request, the login page included, and names what is missing', async () => {
    for (const path of ['/', '/login', '/api/auth/sign-in']) {
      const response = await gate(request(path), deps({ mode: { kind: 'misconfigured', missing: ['NEON_AUTH_COOKIE_SECRET'] } }));
      expect(response.status).toBe(503);
      expect(await response.text()).toBe('Sign-in is not configured: set NEON_AUTH_COOKIE_SECRET.');
    }
  });
});

describe('gate with Neon Auth', () => {
  it('lets anyone reach the login page and the sign-in endpoints, without asking for the session', async () => {
    const session = vi.fn();
    expect(passedThrough(await gate(request('/login'), deps({ session })))).toBe(true);
    expect(passedThrough(await gate(request('/api/auth/sign-in', { method: 'POST' }), deps({ session })))).toBe(true);
    expect(session).not.toHaveBeenCalled();
  });

  it('sends a visitor without a session from a page to the login page, remembering where they were going', async () => {
    const response = await gate(request('/guard?verdict=blocked'), deps());
    expect(response.status).toBe(307);
    expect(response.headers.get('location')).toBe('https://guard.example/login?next=%2Fguard%3Fverdict%3Dblocked');
  });

  it('sends a visitor from the home page to the login page without a next', async () => {
    const response = await gate(request('/'), deps());
    expect(response.headers.get('location')).toBe('https://guard.example/login');
  });

  it('refuses an API call without a session with 401, no redirect', async () => {
    const response = await gate(request('/api/guard/export'), deps());
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: 'Sign in required.' });
  });

  it('lets the owner through and passes on the refreshed session cookies', async () => {
    const session = async () => ({ userId: 'owner-1', cookies: [{ name: '__Secure-neon-auth.session_token', value: 'new', options: { path: '/', httpOnly: true, secure: true } }] });
    const response = await gate(request('/api/guard/export'), deps({ session }));
    expect(passedThrough(response)).toBe(true);
    expect(response.headers.get('set-cookie')).toContain('__Secure-neon-auth.session_token=new');
  });

  it('keeps the PayPal return route behind the session, as it was behind the demo password', async () => {
    expect((await gate(request('/api/sales/paypal-return?token=X'), deps())).status).toBe(401);
    expect(passedThrough(await gate(request('/api/sales/paypal-return?token=X'), deps({ session: async () => ({ userId: 'owner-1', cookies: [] }) })))).toBe(true);
  });

  it('refuses a signed-in account that is not the owner', async () => {
    const session = async () => ({ userId: 'stranger', cookies: [] });
    expect((await gate(request('/'), deps({ session }))).status).toBe(307);
    expect((await gate(request('/api/guard/export'), deps({ session }))).status).toBe(401);
  });

  it('sends everyone to the owner set-up while there is no owner', async () => {
    const response = await gate(request('/settings'), deps({ ownerId: async () => null, session: async () => ({ userId: 'someone', cookies: [] }) }));
    expect(response.headers.get('location')).toBe('https://guard.example/login?next=%2Fsettings');
  });

  it('fails closed when the session or the owner cannot be checked', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const broken = async () => {
      throw new Error('unreachable');
    };
    expect((await gate(request('/api/guard/export'), deps({ session: broken }))).status).toBe(401);
    expect((await gate(request('/api/guard/export'), deps({ session: async () => ({ userId: 'owner-1', cookies: [] }), ownerId: broken }))).status).toBe(401);
    expect((await gate(request('/'), deps({ session: broken }))).status).toBe(307);
    expect(log).toHaveBeenCalled();
    log.mockRestore();
  });

  it('protects the hosted auth pages the SDK would leave open, which this app does not have', async () => {
    expect((await gate(request('/auth/sign-in'), deps())).status).toBe(307);
    expect((await gate(request('/api/auth/get-session'), deps())).status).toBe(401);
  });

  it('refuses a Server Action posted to the login page without a session', async () => {
    const response = await gate(request('/login', { method: 'POST', headers: { 'next-action': 'abc123' } }), deps());
    expect(passedThrough(response)).toBe(false);
  });
});
