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
  apiKey: async () => null,
  ...overrides,
});

const passedThrough = (response: Response) => response.headers.get('x-middleware-next') === '1';
// What the route will see in x-pg-auth: the value the proxy forwards, or null when it removed it.
const forwardedAuth = (response: Response) => {
  const list = response.headers.get('x-middleware-override-headers');
  // Without the override list Next forwards the client's headers untouched.
  expect(list).not.toBeNull();
  const overridden = list!.split(',');
  return overridden.includes('x-pg-auth') ? response.headers.get('x-middleware-request-x-pg-auth') : null;
};

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

  it('lets anyone reach password recovery without a session, and nothing beyond it', async () => {
    const session = vi.fn();
    expect(passedThrough(await gate(request('/login/forgot'), deps({ session })))).toBe(true);
    expect(passedThrough(await gate(request('/login/reset?email=a%40b.example'), deps({ session })))).toBe(true);
    expect(passedThrough(await gate(request('/api/auth/forgot', { method: 'POST' }), deps({ session })))).toBe(true);
    expect(passedThrough(await gate(request('/api/auth/reset', { method: 'POST' }), deps({ session })))).toBe(true);
    expect(session).not.toHaveBeenCalled();
    expect((await gate(request('/api/auth/forgot/x', { method: 'POST' }), deps())).status).toBe(401);
    expect((await gate(request('/login/reset', { method: 'POST', headers: { 'next-action': 'abc123' } }), deps())).status).toBe(307);
  });

  it('refuses a Server Action posted to the login page without a session', async () => {
    const response = await gate(request('/login', { method: 'POST', headers: { 'next-action': 'abc123' } }), deps());
    expect(passedThrough(response)).toBe(false);
  });
});

describe('gate with an API key', () => {
  const KEY = `pg_${'k'.repeat(43)}`;
  const AGENT_ROUTES = ['/api/support/tickets', '/api/billing/tasks', '/api/sales/chats'];
  const bearer = (key = KEY, extra: Record<string, string> = {}) => ({ method: 'POST', headers: { authorization: `Bearer ${key}`, ...extra } });
  const apiKey = vi.fn(async (key: string) => (key === KEY ? { keyId: 'key-1' } : null));
  const demo = { kind: 'demo' } as const;

  it('lets a valid key POST to the three agent routes, with owner login or the demo password, and tells the route', async () => {
    for (const mode of [neon, demo]) {
      for (const path of AGENT_ROUTES) {
        const session = vi.fn();
        const demoGate = vi.fn();
        const response = await gate(request(path, bearer()), deps({ mode, apiKey, session, demo: demoGate }));
        expect(passedThrough(response)).toBe(true);
        expect(forwardedAuth(response)).toBe('api-key:key-1');
        expect(session).not.toHaveBeenCalled();
        expect(demoGate).not.toHaveBeenCalled();
      }
    }
  });

  it('refuses a wrong or revoked key on an agent route with 401 JSON, never a redirect, even with a session', async () => {
    const owner = async () => ({ userId: 'owner-1', cookies: [] });
    for (const mode of [neon, demo]) {
      const response = await gate(request('/api/support/tickets', bearer(`pg_${'x'.repeat(43)}`)), deps({ mode, apiKey, session: owner }));
      expect(response.status).toBe(401);
      expect(response.headers.get('location')).toBeNull();
      expect(await response.json()).toEqual({ error: 'Invalid or revoked API key.' });
    }
  });

  it('fails closed when the key cannot be checked', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const broken = async () => {
      throw new Error('unreachable');
    };
    expect((await gate(request('/api/billing/tasks', bearer()), deps({ apiKey: broken }))).status).toBe(401);
    log.mockRestore();
  });

  it('accepts a key nowhere else: other routes, other methods, paths below, pages, sign-in, Server Actions', async () => {
    apiKey.mockClear();
    const elsewhere: [string, { method: string; headers: Record<string, string> }][] = [
      ['/api/guard/export', bearer()],
      ['/api/guard/approve', bearer()],
      ['/api/support/tickets/x', bearer()],
      ['/api/sales/paypal-return', bearer()],
      ['/settings', bearer()],
      ['/', { ...bearer(), method: 'GET' }],
      ['/api/support/tickets', { ...bearer(), method: 'GET' }],
      ['/api/billing/tasks', { ...bearer(), method: 'PUT' }],
      ['/api/sales/chats', bearer(KEY, { 'next-action': 'abc123' })],
    ];
    for (const [path, init] of elsewhere) {
      const response = await gate(request(path, init), deps({ apiKey }));
      expect(passedThrough(response)).toBe(false);
      expect(response.status === 401 || response.status === 307).toBe(true);
    }
    const demoGate = vi.fn(() => new NextResponse('Authentication required.', { status: 401 }));
    expect((await gate(request('/api/guard/export', bearer()), deps({ mode: demo, apiKey, demo: demoGate }))).status).toBe(401);
    expect(demoGate).toHaveBeenCalledTimes(1);
    expect(apiKey).not.toHaveBeenCalled();
  });

  it('never forwards a key-authenticated mark to the public sign-in endpoints', async () => {
    const response = await gate(request('/api/auth/sign-in', bearer()), deps({ apiKey }));
    expect(passedThrough(response)).toBe(true);
    expect(forwardedAuth(response)).toBeNull();
  });

  it('keeps the half-configured refusal for key requests too', async () => {
    const response = await gate(request('/api/support/tickets', bearer()), deps({ mode: { kind: 'misconfigured', missing: ['DATABASE_URL'] }, apiKey }));
    expect(response.status).toBe(503);
  });

  it('removes an x-pg-auth header the client sent, whoever lets the request through', async () => {
    const forged = { 'x-pg-auth': 'api-key:forged' };
    const owner = async () => ({ userId: 'owner-1', cookies: [] });
    const allowDemo = () => NextResponse.next();
    const cases: [string, Parameters<typeof request>[1], Partial<GateDeps>][] = [
      ['/api/support/tickets', { method: 'POST', headers: forged }, { session: owner }],
      ['/api/support/tickets', { method: 'POST', headers: forged }, { mode: demo, demo: allowDemo }],
      ['/settings', { headers: forged }, { session: owner }],
      ['/login', { headers: forged }, {}],
      ['/api/auth/sign-in', { method: 'POST', headers: forged }, {}],
    ];
    for (const [path, init, overrides] of cases) {
      const response = await gate(request(path, init), deps(overrides));
      expect(passedThrough(response)).toBe(true);
      expect(forwardedAuth(response)).toBeNull();
    }
    const withKey = await gate(request('/api/support/tickets', bearer(KEY, forged)), deps({ apiKey }));
    expect(forwardedAuth(withKey)).toBe('api-key:key-1');
  });

  it('still passes the refreshed session cookies on along with the cleaned headers', async () => {
    const session = async () => ({ userId: 'owner-1', cookies: [{ name: 'c', value: 'v', options: { path: '/' } }] });
    const response = await gate(request('/settings', { headers: { 'x-pg-auth': 'x' } }), deps({ session }));
    expect(response.headers.get('set-cookie')).toContain('c=v');
    expect(forwardedAuth(response)).toBeNull();
  });
});
