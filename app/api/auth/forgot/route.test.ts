import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuthMode } from '@/lib/auth/config';

// Password recovery by email belongs to Neon Auth; the built-in owner account is recovered on the
// server (npm run owner:reset), so both recovery posts are not found in that mode.
let mode: AuthMode = { kind: 'local' };
vi.mock('@/lib/auth/config', () => ({ authMode: () => mode }));
const neon = vi.hoisted(() => ({ sendOtp: vi.fn(async () => ({ error: null })), resetPassword: vi.fn() }));
vi.mock('@/lib/auth/server', () => ({ neonAuth: () => ({ emailOtp: { sendVerificationOtp: neon.sendOtp, resetPassword: neon.resetPassword } }), signOutEverywhere: async () => undefined }));
vi.mock('@/lib/auth/owner', () => ({ ownerEmail: async () => 'owner@shop.example' }));

const forgot = (await import('./route')).POST;
const reset = (await import('../reset/route')).POST;

const post = (handler: typeof forgot, path: string, fields: Record<string, string>) =>
  handler(new NextRequest(`http://localhost:10000${path}`, { method: 'POST', headers: { origin: 'https://guard.example', host: 'guard.example' }, body: new URLSearchParams(fields) }));

describe('password recovery posts', () => {
  beforeEach(() => neon.sendOtp.mockClear());

  it('are not found with the built-in owner account', async () => {
    mode = { kind: 'local' };
    expect((await post(forgot, '/api/auth/forgot', { email: 'owner@shop.example' })).status).toBe(404);
    expect((await post(reset, '/api/auth/reset', { email: 'owner@shop.example', code: '123456', password: 'Strong-password-1', confirm: 'Strong-password-1' })).status).toBe(404);
    expect(neon.sendOtp).not.toHaveBeenCalled();
    expect(neon.resetPassword).not.toHaveBeenCalled();
  });

  it('still email a code to the owner with Neon Auth', async () => {
    mode = { kind: 'neon', baseUrl: 'https://auth.example', cookieSecret: 'x'.repeat(32) };
    const res = await post(forgot, '/api/auth/forgot', { email: 'owner@shop.example' });
    expect(res.status).toBe(303);
    expect(res.headers.get('location')).toBe('/login/reset?email=owner%40shop.example');
    expect(neon.sendOtp).toHaveBeenCalledWith({ email: 'owner@shop.example', type: 'forget-password' });
  });

  it('still reset the password with Neon Auth', async () => {
    mode = { kind: 'neon', baseUrl: 'https://auth.example', cookieSecret: 'x'.repeat(32) };
    neon.resetPassword.mockResolvedValue({ error: null });
    const res = await post(reset, '/api/auth/reset', { email: 'owner@shop.example', code: '123456', password: 'Strong-password-1', confirm: 'Strong-password-1' });
    expect(res.headers.get('location')).toBe('/login?reset=done');
  });
});
