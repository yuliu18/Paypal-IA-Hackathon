import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const signIn = vi.fn();
vi.mock('@/lib/auth/config', () => ({ authMode: () => ({ kind: 'neon', baseUrl: 'https://auth.example', cookieSecret: 'x'.repeat(32) }) }));
vi.mock('@/lib/auth/server', () => ({ neonAuth: () => ({ signIn: { email: signIn }, signOut: async () => undefined }) }));
vi.mock('@/lib/auth/owner', () => ({ owner: { ownerId: async () => 'owner-id' } }));

const { POST } = await import('./route');

// A same-site form post; `client` is the address it claims (headers a caller can forge).
const post = (email: string, password: string, client: string) =>
  POST(
    new NextRequest('http://localhost:10000/api/auth/sign-in', {
      method: 'POST',
      headers: { origin: 'https://guard.example', host: 'guard.example', 'x-forwarded-for': client },
      body: new URLSearchParams({ email, password, next: '/guard' }),
    }),
  );
const wrong = { data: null, error: { status: 401, message: 'Invalid email or password' } };
const right = { data: { user: { id: 'owner-id' } }, error: null };

describe('POST /api/auth/sign-in', () => {
  beforeEach(() => signIn.mockReset());

  it('signs the owner in and sends them where they were going', async () => {
    signIn.mockResolvedValue(right);
    const res = await post('owner1@shop.example', 'Right-password-1', '10.0.0.1');
    expect(res.status).toBe(303);
    expect(res.headers.get('location')).toBe('/guard');
  });

  it('locks the account after 5 wrong passwords even when every try claims a new client, without asking Neon Auth again', async () => {
    signIn.mockResolvedValue(wrong);
    for (let i = 0; i < 5; i++) expect((await post('owner2@shop.example', 'Wrong-password-1', `10.1.0.${i}`)).headers.get('location')).toBe('/login?error=invalid&next=%2Fguard');
    signIn.mockResolvedValue(right);
    expect((await post('owner2@shop.example', 'Right-password-1', '10.1.0.99')).headers.get('location')).toBe('/login?error=locked&next=%2Fguard');
    expect(signIn).toHaveBeenCalledTimes(5);
  });

  it('starts the account count over after the owner signs in', async () => {
    signIn.mockResolvedValue(wrong);
    for (let i = 0; i < 4; i++) await post('owner3@shop.example', 'Wrong-password-1', `10.2.0.${i}`);
    signIn.mockResolvedValue(right);
    expect((await post('owner3@shop.example', 'Right-password-1', '10.2.0.50')).headers.get('location')).toBe('/guard');
    signIn.mockResolvedValue(wrong);
    expect((await post('owner3@shop.example', 'Wrong-password-1', '10.2.0.51')).headers.get('location')).toBe('/login?error=invalid&next=%2Fguard');
  });
});
