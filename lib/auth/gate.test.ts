import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { NextRequest } from 'next/server';
import { afterAll, describe, expect, it, vi } from 'vitest';
import type { AuthMode } from './config';
import { gate, type GateDeps } from './gate';
import { localSession, SESSION_COOKIE, startSession } from './local-session';
import { createSqliteAuthStore } from './sqlite-auth-store';

const neon: AuthMode = { kind: 'neon', baseUrl: 'https://auth.example/neondb/auth', cookieSecret: 'x'.repeat(32) };
const request = (path: string, init: { method?: string; headers?: Record<string, string> } = {}) =>
  new NextRequest(`https://guard.example${path}`, init);

const deps = (overrides: Partial<GateDeps> = {}): GateDeps => ({
  mode: neon,
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

// The built-in owner account, as proxy.ts wires it: sessions read from a real SQLite store.
const scratch = mkdtempSync(join(tmpdir(), 'gate-'));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));
let stores = 0;
const localStore = () => createSqliteAuthStore(join(scratch, `auth-${++stores}.db`));
const local: AuthMode = { kind: 'local' };
const withCookie = (path: string, token: string, init: { method?: string } = {}) => request(path, { ...init, headers: { cookie: `${SESSION_COOKIE}=${token}` } });

describe('gate with the built-in owner account', () => {
  const t0 = new Date('2026-11-02T10:00:00Z');
  const setUp = async () => {
    const store = localStore();
    await store.createOwner({ email: 'owner@shop.example', passwordHash: 'scrypt$x' }, t0);
    let clock = t0;
    const read = localSession(() => store, () => clock);
    return { store, read, token: await startSession(store, t0), at: (date: Date) => (clock = date) };
  };

  it('lets the owner’s session through', async () => {
    const { read, token } = await setUp();
    expect(passedThrough(await gate(withCookie('/guard', token), deps({ mode: local, ...read })))).toBe(true);
    expect(passedThrough(await gate(withCookie('/api/guard/export', token), deps({ mode: local, ...read })))).toBe(true);
  });

  it('sends a page without a session to the login page (an absolute URL) and refuses an API call with 401', async () => {
    const { read } = await setUp();
    const page = await gate(request('/guard?verdict=blocked'), deps({ mode: local, ...read }));
    expect(page.status).toBe(307);
    expect(page.headers.get('location')).toBe('https://guard.example/login?next=%2Fguard%3Fverdict%3Dblocked');
    const api = await gate(request('/api/guard/export'), deps({ mode: local, ...read }));
    expect(api.status).toBe(401);
    expect(await api.json()).toEqual({ error: 'Sign in required.' });
    expect((await gate(withCookie('/guard', 'made-up'), deps({ mode: local, ...read }))).status).toBe(307);
  });

  it('refuses a session once it has expired, 7 days after it started', async () => {
    const { read, token, at } = await setUp();
    at(new Date(t0.getTime() + 7 * 24 * 3600_000 - 1));
    expect(passedThrough(await gate(withCookie('/guard', token), deps({ mode: local, ...read })))).toBe(true);
    at(new Date(t0.getTime() + 7 * 24 * 3600_000));
    expect((await gate(withCookie('/guard', token), deps({ mode: local, ...read }))).status).toBe(307);
    expect((await gate(withCookie('/api/guard/export', token), deps({ mode: local, ...read }))).status).toBe(401);
  });

  it('lets anyone reach the login page and the sign-in endpoints without reading the store', async () => {
    const store = vi.fn(() => {
      throw new Error('should not be read');
    });
    const read = localSession(store);
    expect(passedThrough(await gate(request('/login'), deps({ mode: local, ...read })))).toBe(true);
    for (const path of ['/api/auth/sign-in', '/api/auth/owner', '/api/auth/sign-out']) {
      expect(passedThrough(await gate(request(path, { method: 'POST' }), deps({ mode: local, ...read })))).toBe(true);
    }
    expect(passedThrough(await gate(request('/checkout?paid=ok'), deps({ mode: local, ...read })))).toBe(true);
    expect(store).not.toHaveBeenCalled();
  });

  it('fails closed when the store cannot be opened or read', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { token } = await setUp();
    const broken = localSession(() => {
      throw new Error('disk gone');
    });
    expect((await gate(withCookie('/guard', token), deps({ mode: local, ...broken }))).status).toBe(307);
    expect((await gate(withCookie('/api/guard/export', token), deps({ mode: local, ...broken }))).status).toBe(401);
    const store = localStore();
    store.close?.();
    expect((await gate(withCookie('/api/guard/export', token), deps({ mode: local, ...localSession(() => store) }))).status).toBe(401);
    expect(log).toHaveBeenCalled();
    log.mockRestore();
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

  it('lets a buyer back from PayPal reach the capture route and its result page without signing in', async () => {
    expect(passedThrough(await gate(request('/api/sales/paypal-return?token=X'), deps()))).toBe(true);
    expect(passedThrough(await gate(request('/checkout?paid=ok'), deps()))).toBe(true);
    expect((await gate(request('/api/support/paypal-return?token=X'), deps())).status).not.toBe(200);
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

  it('lets a valid key POST to the three agent routes, with Neon Auth or the built-in owner account, and tells the route', async () => {
    for (const mode of [neon, local]) {
      for (const path of AGENT_ROUTES) {
        const session = vi.fn();
        const response = await gate(request(path, bearer()), deps({ mode, apiKey, session }));
        expect(passedThrough(response)).toBe(true);
        expect(forwardedAuth(response)).toBe('api-key:key-1');
        expect(session).not.toHaveBeenCalled();
      }
    }
  });

  it('refuses a wrong or revoked key on an agent route with 401 JSON, never a redirect, even with a session', async () => {
    const owner = async () => ({ userId: 'owner-1', cookies: [] });
    for (const mode of [neon, local]) {
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
    for (const mode of [neon, local]) {
      for (const [path, init] of elsewhere) {
        const response = await gate(request(path, init), deps({ mode, apiKey }));
        expect(passedThrough(response)).toBe(false);
        expect(response.status === 401 || response.status === 307).toBe(true);
      }
    }
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
    const cases: [string, Parameters<typeof request>[1], Partial<GateDeps>][] = [
      ['/api/support/tickets', { method: 'POST', headers: forged }, { session: owner }],
      ['/api/support/tickets', { method: 'POST', headers: forged }, { mode: local, session: owner }],
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
