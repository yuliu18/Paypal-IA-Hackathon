import { describe, expect, it } from 'vitest';
import { isPublicRequest, neonAccess, safeNextPath, sameOrigin } from './access';

describe('isPublicRequest', () => {
  it('opens only the login page and the sign-in, owner set-up and sign-out endpoints', () => {
    expect(isPublicRequest({ method: 'GET', pathname: '/login' })).toBe(true);
    expect(isPublicRequest({ method: 'HEAD', pathname: '/login' })).toBe(true);
    expect(isPublicRequest({ method: 'POST', pathname: '/api/auth/sign-in' })).toBe(true);
    expect(isPublicRequest({ method: 'POST', pathname: '/api/auth/owner' })).toBe(true);
    expect(isPublicRequest({ method: 'POST', pathname: '/api/auth/sign-out' })).toBe(true);
  });

  it('keeps every other page and API route behind the session', () => {
    for (const pathname of ['/', '/guard', '/settings', '/sales', '/api/guard/export', '/api/sales/paypal-return', '/login-other', '/api/auth', '/api/auth/get-session', '/auth/sign-in']) {
      expect(isPublicRequest({ method: 'GET', pathname })).toBe(false);
      expect(isPublicRequest({ method: 'POST', pathname })).toBe(false);
    }
  });

  it('does not open the login page to other methods, so no Server Action can run through it', () => {
    expect(isPublicRequest({ method: 'POST', pathname: '/login' })).toBe(false);
    expect(isPublicRequest({ method: 'GET', pathname: '/api/auth/sign-in' })).toBe(false);
  });

  it('refuses a Server Action call even on a public path', () => {
    expect(isPublicRequest({ method: 'GET', pathname: '/login', serverAction: true })).toBe(false);
    expect(isPublicRequest({ method: 'POST', pathname: '/api/auth/sign-in', serverAction: true })).toBe(false);
  });
});

describe('neonAccess', () => {
  it('lets in the owner only', () => {
    expect(neonAccess({ userId: 'owner-1', ownerId: 'owner-1' })).toBe('allow');
  });

  it('sends everyone else to sign in: no session, another account, or no owner yet', () => {
    expect(neonAccess({ userId: undefined, ownerId: 'owner-1' })).toBe('sign-in');
    expect(neonAccess({ userId: 'stranger', ownerId: 'owner-1' })).toBe('sign-in');
    expect(neonAccess({ userId: 'someone', ownerId: null })).toBe('sign-in');
    expect(neonAccess({ userId: undefined, ownerId: null })).toBe('sign-in');
  });
});

describe('safeNextPath', () => {
  it('keeps a path on this site', () => {
    expect(safeNextPath('/guard?verdict=blocked')).toBe('/guard?verdict=blocked');
  });

  it('falls back to the home page for anything that could leave the site or loop back to login', () => {
    for (const next of [null, undefined, '', 'https://evil.example', '//evil.example', '/\\evil.example', 'guard', '/login', '/login?next=/', '/api/auth/sign-in']) {
      expect(safeNextPath(next)).toBe('/');
    }
  });
});

describe('sameOrigin', () => {
  it('accepts a form posted from this site', () => {
    expect(sameOrigin(new Headers({ origin: 'https://guard.example', host: 'guard.example' }))).toBe(true);
    expect(sameOrigin(new Headers({ origin: 'http://localhost:3126', host: 'localhost:3126' }))).toBe(true);
  });

  it('refuses a post from another site or without an origin', () => {
    expect(sameOrigin(new Headers({ origin: 'https://evil.example', host: 'guard.example' }))).toBe(false);
    expect(sameOrigin(new Headers({ host: 'guard.example' }))).toBe(false);
    expect(sameOrigin(new Headers({ origin: 'null', host: 'guard.example' }))).toBe(false);
  });
});
