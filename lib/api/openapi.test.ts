import { describe, expect, it } from 'vitest';
import { API_KEY_ROUTES } from '@/lib/auth/access';
import { openApiDocument } from './openapi';

describe('openApiDocument', () => {
  const doc = openApiDocument('https://shop.example');
  const paths = doc.paths as Record<string, (typeof doc.paths)['/api/support/tickets']>;

  it('describes exactly the endpoints an API key opens, each a POST', () => {
    expect(Object.keys(doc.paths).sort()).toEqual([...API_KEY_ROUTES].sort());
    for (const path of API_KEY_ROUTES) expect(Object.keys(paths[path])).toEqual(['post']);
  });

  it('asks for the API key as a bearer token on every endpoint', () => {
    expect(doc.components.securitySchemes.apiKey).toMatchObject({ type: 'http', scheme: 'bearer' });
    for (const path of API_KEY_ROUTES) expect(paths[path].post.security).toEqual([{ apiKey: [] }]);
  });

  it('states the request rules the routes enforce', () => {
    const request = doc.components.schemas.AgentRequest;
    expect(request.required).toEqual(['customerEmail', 'message']);
    expect(request.properties.message).toMatchObject({ minLength: 1, maxLength: 4000 });
    expect(request.properties.agent).toMatchObject({ enum: ['careful', 'vulnerable'], default: 'careful' });
  });

  it('documents the answers every endpoint can give', () => {
    for (const path of API_KEY_ROUTES) expect(Object.keys(paths[path].post.responses)).toEqual(['200', '400', '401', '429', '502']);
  });

  it('points the server at the given origin, or at the current one', () => {
    expect(doc.servers).toEqual([{ url: 'https://shop.example' }]);
    expect(openApiDocument().servers).toEqual([{ url: '/' }]);
  });
});
