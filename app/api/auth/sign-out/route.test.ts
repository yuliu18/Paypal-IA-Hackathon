import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { NextRequest } from 'next/server';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuthMode } from '@/lib/auth/config';

let mode: AuthMode = { kind: 'local' };
vi.mock('@/lib/auth/config', () => ({ authMode: () => mode }));
const neon = vi.hoisted(() => ({ signOut: vi.fn(async () => undefined), jar: new Map<string, { value: string; options?: Record<string, unknown> }>() }));
vi.mock('@/lib/auth/server', () => ({ neonAuth: () => ({ signOut: neon.signOut }) }));
vi.mock('next/headers', () => ({
  cookies: async () => ({
    getAll: () => [...neon.jar].map(([name, { value }]) => ({ name, value })),
    set: (name: string, value: string, options?: Record<string, unknown>) => neon.jar.set(name, { value, options }),
  }),
}));

const scratch = mkdtempSync(join(tmpdir(), 'sign-out-route-'));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));
delete process.env.DATABASE_URL;

const { POST } = await import('./route');
const { localAuthStore } = await import('@/lib/auth/local-store');
const { localSession, startSession } = await import('@/lib/auth/local-session');

const post = (cookie?: string) =>
  POST(
    new NextRequest('http://localhost:10000/api/auth/sign-out', {
      method: 'POST',
      headers: { origin: 'https://guard.example', host: 'guard.example', 'x-forwarded-proto': 'https', ...(cookie ? { cookie } : {}) },
    }),
  );
const page = (token: string) => new NextRequest('https://guard.example/guard', { headers: { cookie: `pg_session=${token}` } });

describe('POST /api/auth/sign-out with the built-in owner account', () => {
  beforeEach(() => {
    mode = { kind: 'local' };
    process.env.AUTH_DB = join(scratch, `auth-${Math.random()}.db`);
  });

  it('ends the session in the store, clears the cookie and shows the login page', async () => {
    const store = localAuthStore();
    await store.createOwner({ email: 'o@shop.example', passwordHash: 'scrypt$x' }, new Date());
    const token = await startSession(store);
    const other = await startSession(store);
    const read = localSession(() => store);
    expect((await read.session(page(token))).userId).toBe('owner');

    const res = await post(`pg_session=${token}`);
    expect(res.status).toBe(303);
    expect(res.headers.get('location')).toBe('/login');
    const cookie = res.headers.get('set-cookie')!;
    expect(cookie).toMatch(/^pg_session=;/);
    expect(cookie).toMatch(/Max-Age=0/);
    expect(cookie).toMatch(/Path=\//);
    expect((await read.session(page(token))).userId).toBeUndefined();
    expect((await read.session(page(other))).userId).toBe('owner');
  });

  it('clears the cookie and shows the login page even without a session', async () => {
    const res = await post();
    expect(res.headers.get('location')).toBe('/login');
    expect(res.headers.get('set-cookie')).toMatch(/^pg_session=;/);
  });
});

describe('POST /api/auth/sign-out with Neon Auth', () => {
  it('still signs out at Neon Auth and clears its cookies', async () => {
    mode = { kind: 'neon', baseUrl: 'https://auth.example', cookieSecret: 'x'.repeat(32) };
    neon.jar.set('__Secure-neon-auth.session_token', { value: 'abc' });
    neon.jar.set('unrelated', { value: 'keep' });
    const res = await post();
    expect(res.headers.get('location')).toBe('/login');
    expect(neon.signOut).toHaveBeenCalled();
    expect(neon.jar.get('__Secure-neon-auth.session_token')).toMatchObject({ value: '', options: { maxAge: 0 } });
    expect(neon.jar.get('unrelated')?.value).toBe('keep');
  });
});
