import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { NextRequest } from 'next/server';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

// The sign-in form's post with the built-in owner account (no Neon Auth, no database: SQLite).
const scrypt = vi.hoisted(() => ({ verify: vi.fn(), spend: vi.fn() }));
vi.mock('@/lib/auth/config', () => ({ authMode: () => ({ kind: 'local' }) }));
// Neon Auth is never asked in this mode.
const neonUsed = () => {
  throw new Error('Neon Auth must not be used in local mode');
};
vi.mock('@/lib/auth/server', () => ({ neonAuth: neonUsed }));
vi.mock('@/lib/auth/owner', () => ({ owner: { ownerId: neonUsed, forget: () => undefined }, ownerEmail: neonUsed }));
vi.mock('@/lib/auth/scrypt', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/auth/scrypt')>();
  scrypt.verify.mockImplementation(actual.verifyPassword);
  scrypt.spend.mockImplementation(actual.spendPasswordCheck);
  return { ...actual, verifyPassword: scrypt.verify, spendPasswordCheck: scrypt.spend };
});

const scratch = mkdtempSync(join(tmpdir(), 'sign-in-local-'));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));
delete process.env.DATABASE_URL;

const { POST } = await import('./route');
const { hashPassword } = await import('@/lib/auth/scrypt');
const { localAuthStore } = await import('@/lib/auth/local-store');

const PASSWORD = 'Right-password-1';
const storedHash = await hashPassword(PASSWORD);
let files = 0;
let path = '';
// Every test gets its own account file and owner address, so the per-account counts stay apart.
async function ownerAt(email: string) {
  path = join(scratch, `auth-${++files}.db`);
  process.env.AUTH_DB = path;
  await localAuthStore().createOwner({ email, passwordHash: storedHash }, new Date());
}
const sessions = () => new DatabaseSync(path).prepare('SELECT token_hash FROM sessions').all() as { token_hash: string }[];

const post = (email: string, password: string, client: string, proto = 'https') =>
  POST(
    new NextRequest('http://localhost:10000/api/auth/sign-in', {
      method: 'POST',
      headers: { origin: 'https://guard.example', host: 'guard.example', 'x-forwarded-for': client, 'x-forwarded-proto': proto },
      body: new URLSearchParams({ email, password, next: '/guard' }),
    }),
  );

describe('POST /api/auth/sign-in with the built-in owner account', () => {
  beforeEach(() => {
    scrypt.verify.mockClear();
    scrypt.spend.mockClear();
  });

  it('signs the owner in: a session cookie (HttpOnly, SameSite=Lax, Path=/, Secure, 7 days) whose hash alone is stored, and a 303 to where they were going', async () => {
    await ownerAt('local1@shop.example');
    const res = await post('Local1@Shop.example ', PASSWORD, '10.9.0.1');
    expect(res.status).toBe(303);
    expect(res.headers.get('location')).toBe('/guard');
    const cookie = res.headers.get('set-cookie')!;
    expect(cookie).toMatch(/^pg_session=[A-Za-z0-9_-]{43};/);
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=lax/i);
    expect(cookie).toMatch(/Path=\//);
    expect(cookie).toMatch(/Secure/i);
    expect(cookie).toMatch(/Max-Age=604800/);
    const token = /^pg_session=([^;]+)/.exec(cookie)![1];
    expect(sessions()).toEqual([{ token_hash: createHash('sha256').update(token).digest('hex') }]);
  });

  it('leaves Secure off over plain http (local development)', async () => {
    await ownerAt('local2@shop.example');
    const cookie = (await post('local2@shop.example', PASSWORD, '10.9.0.2', 'http')).headers.get('set-cookie')!;
    expect(cookie).toMatch(/^pg_session=/);
    expect(cookie).not.toMatch(/Secure/i);
  });

  it('refuses a wrong password without a cookie, and counts it: from the 5th the account is locked even for the right one, whatever client it claims', async () => {
    await ownerAt('local3@shop.example');
    for (let i = 0; i < 5; i++) {
      const res = await post('local3@shop.example', 'Wrong-password-1', `10.9.1.${i}`);
      expect(res.headers.get('location')).toBe('/login?error=invalid&next=%2Fguard');
      expect(res.headers.get('set-cookie')).toBeNull();
    }
    expect((await post('local3@shop.example', PASSWORD, '10.9.1.99')).headers.get('location')).toBe('/login?error=locked&next=%2Fguard');
    expect(scrypt.verify).toHaveBeenCalledTimes(5);
    expect(sessions()).toEqual([]);
  });

  it('locks a client out after 10 wrong passwords, whatever addresses it tries', async () => {
    await ownerAt('local4@shop.example');
    for (let i = 0; i < 10; i++) await post(`nobody${i}@x.example`, 'Wrong-password-1', '10.9.2.1');
    expect((await post('local4@shop.example', PASSWORD, '10.9.2.1')).headers.get('location')).toBe('/login?error=locked&next=%2Fguard');
    expect((await post('local4@shop.example', PASSWORD, '10.9.2.2')).headers.get('location')).toBe('/guard');
  });

  it('lets at most 5 guesses reach the password check when 200 arrive at once', async () => {
    await ownerAt('local5@shop.example');
    const answers = await Promise.all(Array.from({ length: 200 }, (_, i) => post('local5@shop.example', 'Wrong-password-1', `10.9.${3 + (i >> 8)}.${i & 255}`)));
    expect(scrypt.verify).toHaveBeenCalledTimes(5);
    expect(answers.filter((r) => r.headers.get('location') === '/login?error=locked&next=%2Fguard')).toHaveLength(195);
  });

  it('spends a hash on an address that is not the owner’s, answers like a wrong password, and does not count it against the owner', async () => {
    await ownerAt('local6@shop.example');
    for (let i = 0; i < 6; i++) expect((await post('stranger@x.example', PASSWORD, `10.9.5.${i}`)).headers.get('location')).toBe(i < 5 ? '/login?error=invalid&next=%2Fguard' : '/login?error=locked&next=%2Fguard');
    expect(scrypt.spend).toHaveBeenCalledTimes(5);
    expect(scrypt.verify).not.toHaveBeenCalled();
    expect((await post('local6@shop.example', PASSWORD, '10.9.5.50')).headers.get('location')).toBe('/guard');
  });

  it('answers "unavailable" and lets nobody in when the account file cannot be read', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    process.env.AUTH_DB = join(scratch, 'not-a-dir.db', '\0bad');
    const res = await post('local7@shop.example', PASSWORD, '10.9.6.1');
    expect(res.headers.get('location')).toBe('/login?error=unavailable&next=%2Fguard');
    expect(res.headers.get('set-cookie')).toBeNull();
    log.mockRestore();
  });

  it('refuses a cross-site post', async () => {
    await ownerAt('local8@shop.example');
    const res = await POST(new NextRequest('http://localhost:10000/api/auth/sign-in', { method: 'POST', headers: { origin: 'https://evil.example', host: 'guard.example' }, body: new URLSearchParams({ email: 'local8@shop.example', password: PASSWORD }) }));
    expect(res.status).toBe(403);
  });
});
