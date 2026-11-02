'use server';

import { refresh } from 'next/cache';
import { apiKeys, type ApiKeySummary } from '@/lib/apikeys/keys';

// Creating and revoking API keys from Settings. Like the page, these actions sit behind the owner's
// session (Neon Auth or the built-in login): the proxy never lets a Server Action through without it, and an
// API key never opens one (lib/auth/gate.ts). The new key goes back to the page once and is never
// logged or stored.

export type ApiKeyError = 'invalid-name' | 'not-found' | 'unavailable' | 'locked' | 'failed';
export type CreateKeyState = { ok: true; key: string; summary: ApiKeySummary } | { ok: false; error: ApiKeyError } | null;

const locked = () => process.env.SETTINGS_LOCKED === 'true';

export async function createApiKeyAction(_previous: CreateKeyState, form: FormData): Promise<CreateKeyState> {
  if (locked()) return { ok: false, error: 'locked' };
  try {
    const result = await (await apiKeys()).create(String(form.get('name') ?? ''));
    if (!result.ok) return { ok: false, error: result.reason };
    refresh();
    return result;
  } catch (error) {
    console.error('Creating an API key failed', error);
    return { ok: false, error: 'failed' };
  }
}

export async function revokeApiKeyAction(id: string): Promise<{ ok: true } | { ok: false; error: ApiKeyError }> {
  if (locked()) return { ok: false, error: 'locked' };
  try {
    const result = await (await apiKeys()).revoke(id);
    if (!result.ok) return { ok: false, error: result.reason };
    refresh();
    return { ok: true };
  } catch (error) {
    console.error('Revoking an API key failed', error);
    return { ok: false, error: 'failed' };
  }
}
