import { afterEach, describe, expect, it, vi } from 'vitest';
import { GET } from './route';

afterEach(() => vi.unstubAllEnvs());

describe('GET /api/openapi', () => {
  it('serves the agent API document with APP_URL as its server', async () => {
    vi.stubEnv('APP_URL', 'https://shop.example');
    const response = GET();
    expect(response.status).toBe(200);
    const doc = await response.json();
    expect(doc.openapi).toBe('3.1.0');
    expect(doc.servers).toEqual([{ url: 'https://shop.example' }]);
    expect(Object.keys(doc.paths)).toContain('/api/support/tickets');
  });

  it('names the current origin when APP_URL is unset', async () => {
    vi.stubEnv('APP_URL', '');
    expect((await GET().json()).servers).toEqual([{ url: '/' }]);
  });
});
