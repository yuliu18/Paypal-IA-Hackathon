import { NextRequest } from 'next/server';
import { describe, expect, it } from 'vitest';
import { backToLogin, seeOther } from './form-post';

// Render's server listens on localhost:10000 behind its proxy: the request's own URL names that.
const internal = new NextRequest('http://localhost:10000/api/auth/sign-in', { method: 'POST' });

describe('form post answers', () => {
  it('send the browser to a path on the host it is on, never the server’s internal address', () => {
    const response = seeOther(internal, '/guard');
    expect(response.status).toBe(303);
    expect(response.headers.get('location')).toBe('/guard');
  });

  it('go back to the login page with the error and where to return', () => {
    expect(backToLogin(internal, 'invalid', '/settings').headers.get('location')).toBe('/login?error=invalid&next=%2Fsettings');
  });
});
