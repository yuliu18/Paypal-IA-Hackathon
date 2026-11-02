import type { NextRequest } from 'next/server';
import { apiKeys } from '@/lib/apikeys/keys';
import { authMode } from '@/lib/auth/config';
import { gate } from '@/lib/auth/gate';
import { localSession } from '@/lib/auth/local-session';
import { localAuthStore } from '@/lib/auth/local-store';
import { owner } from '@/lib/auth/owner';
import { readSession } from '@/lib/auth/session';

const local = localSession(() => localAuthStore());

// Only the owner's session opens a page or API route (lib/auth/gate.ts): with Neon Auth
// (NEON_AUTH_BASE_URL set) its session, otherwise the app's own (lib/auth/local-session.ts). In
// both, the agent routes also take an API key (lib/apikeys, needs DATABASE_URL). Static assets don't
// pass through here.
export function proxy(request: NextRequest) {
  const mode = authMode();
  return gate(request, {
    mode,
    ...(mode.kind === 'neon' ? { session: (req: NextRequest) => readSession(req, mode), ownerId: () => owner.ownerId() } : local),
    apiKey: async (key) => (await apiKeys()).verify(key),
  });
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
