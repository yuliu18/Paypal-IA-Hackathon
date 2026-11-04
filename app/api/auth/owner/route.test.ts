import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { NextRequest } from 'next/server';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuthMode } from '@/lib/auth/config';

let mode: AuthMode = { kind: 'local' };
vi.mock('@/lib/auth/config', () => ({ authMode: () => mode }));
const neon = vi.hoisted(() => ({ signUp: vi.fn(), signOut: vi.fn(async () => undefined), ownerId: vi.fn() }));
vi.mock('@/lib/auth/server', () => ({ neonAuth: () => ({ signUp: { email: neon.signUp }, signOut: neon.signOut }) }));
vi.mock('@/lib/auth/owner', () => ({ owner: { ownerId: neon.ownerId, forget: () => undefined } }));

const scratch = mkdtempSync(join(tmpdir(), 'owner-route-'));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));
delete process.env.DATABASE_URL;

const { POST } = await import('./route');
const { verifyPassword } = await import('@/lib/auth/scrypt');

const PASSWORD = 'Strong-password-1';
const post = (fields: Record<string, string>) =>
  POST(
    new NextRequest('http://localhost:10000/api/auth/owner', {
      method: 'POST',
      headers: { origin: 'https://guard.example', host: 'guard.example', 'x-forwarded-proto': 'https' },
      body: new URLSearchParams(fields),
    }),
  );
const setUp = (email = 'owner@shop.example', password = PASSWORD, confirm = password) => post({ email, password, confirm });

let files = 0;
let path = '';
const rows = (table: string) => new DatabaseSync(path).prepare(`SELECT * FROM ${table}`).all() as Record<string, string>[];

describe('POST /api/auth/owner with the built-in owner account', () => {
  beforeEach(() => {
    mode = { kind: 'local' };
    path = join(scratch, `auth-${++files}.db`);
    process.env.AUTH_DB = path;
  });

  it('creates the owner with a scrypt hash only, signs them in and goes home', async () => {
    const res = await setUp(' Owner@Shop.example ');
    expect(res.status).toBe(303);
    expect(res.headers.get('location')).toBe('/');
    expect(res.headers.get('set-cookie')).toMatch(/^pg_session=[A-Za-z0-9_-]{43};.*HttpOnly/i);
    const [row] = rows('owner');
    expect(row.email).toBe('owner@shop.example');
    expect(row.password_hash).toMatch(/^scrypt\$32768\$8\$1\$/);
    expect(JSON.stringify(row)).not.toContain(PASSWORD);
    expect(await verifyPassword(PASSWORD, row.password_hash)).toBe(true);
    expect(rows('sessions')).toHaveLength(1);
  });

  it('creates it once: a second set-up, even at the same moment, is refused with ownerExists', async () => {
    const [a, b] = await Promise.all([setUp('first@shop.example'), setUp('second@shop.example')]);
    const locations = [a, b].map((r) => r.headers.get('location')).sort();
    expect(locations).toEqual(['/', '/login?error=ownerExists']);
    const late = await setUp('late@shop.example');
    expect(late.headers.get('location')).toBe('/login?error=ownerExists');
    expect(late.headers.get('set-cookie')).toBeNull();
    expect(rows('owner')).toHaveLength(1);
    expect(rows('sessions')).toHaveLength(1);
  });

  it('applies the same rules as with Neon Auth: a valid email, the same password twice, a strong password', async () => {
    expect((await setUp('not-an-email')).headers.get('location')).toBe('/login?error=email');
    expect((await setUp('owner@shop.example', PASSWORD, 'Other-password-1')).headers.get('location')).toBe('/login?error=mismatch');
    expect((await setUp('owner@shop.example', 'weakpassword', 'weakpassword')).headers.get('location')).toBe('/login?error=weak');
    expect(rows('owner')).toEqual([]);
  });

  it('refuses a cross-site post', async () => {
    const res = await POST(new NextRequest('http://localhost:10000/api/auth/owner', { method: 'POST', headers: { origin: 'https://evil.example', host: 'guard.example' }, body: new URLSearchParams({ email: 'a@b.example', password: PASSWORD, confirm: PASSWORD }) }));
    expect(res.status).toBe(403);
  });
});

describe('POST /api/auth/owner with Neon Auth', () => {
  beforeEach(() => {
    mode = { kind: 'neon', baseUrl: 'https://auth.example', cookieSecret: 'x'.repeat(32) };
    neon.signUp.mockReset();
    neon.ownerId.mockReset();
  });

  it('still creates the owner at Neon Auth and goes home, without a local session', async () => {
    neon.ownerId.mockResolvedValueOnce(null).mockResolvedValueOnce('new-id');
    neon.signUp.mockResolvedValue({ data: { user: { id: 'new-id' } }, error: null });
    const res = await setUp();
    expect(res.headers.get('location')).toBe('/');
    expect(res.headers.get('set-cookie')).toBeNull();
    expect(neon.signUp).toHaveBeenCalledWith({ email: 'owner@shop.example', password: PASSWORD, name: 'Owner' });
  });

  it('still refuses a second set-up', async () => {
    neon.ownerId.mockResolvedValue('existing');
    expect((await setUp()).headers.get('location')).toBe('/login?error=ownerExists');
    expect(neon.signUp).not.toHaveBeenCalled();
  });
});
