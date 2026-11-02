import { describe, expect, it } from 'vitest';
import { relativeRedirect } from './redirect';

describe('relativeRedirect', () => {
  it('names only the path, so the browser stays on the public host whatever the server listens on', () => {
    const response = relativeRedirect('/guard?verdict=held', 303);
    expect(response.status).toBe(303);
    expect(response.headers.get('location')).toBe('/guard?verdict=held');
  });

  it('defaults to a temporary redirect', () => {
    expect(relativeRedirect('/login').status).toBe(307);
  });

  it('refuses anything that could leave the site', () => {
    for (const target of ['//evil.example', '/\\evil.example', 'https://evil.example', 'guard', '']) {
      expect(() => relativeRedirect(target)).toThrow();
    }
  });
});
