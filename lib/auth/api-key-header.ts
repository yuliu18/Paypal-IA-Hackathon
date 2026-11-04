// How the proxy tells a route that its caller used an API key rather than the owner's session:
// it sets `x-pg-auth: api-key:<key id>` on the request it forwards, after
// removing any copy the client sent (lib/auth/gate.ts), so a route can trust it.

export const API_KEY_AUTH_HEADER = 'x-pg-auth';
const PREFIX = 'api-key:';

export const apiKeyAuthValue = (keyId: string) => `${PREFIX}${keyId}`;

// The id of the API key the request was let in with; null when it came in another way.
export function apiKeyIdFrom(headers: Headers): string | null {
  const value = headers.get(API_KEY_AUTH_HEADER);
  if (!value?.startsWith(PREFIX)) return null;
  return value.slice(PREFIX.length) || null;
}
