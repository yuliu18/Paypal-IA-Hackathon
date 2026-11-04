// Which sign-in protects the app, from the environment:
// - `neon`: the owner signs in with an email and password kept by Neon Auth (NEON_AUTH_BASE_URL),
//   with session cookies signed by NEON_AUTH_COOKIE_SECRET and the owner looked up in DATABASE_URL.
// - `local`: Neon Auth not set up: the app's own owner account (lib/auth/local-*.ts), an email and
//   a scrypt-hashed password with server-side sessions, kept in DATABASE_URL's `auth` schema or,
//   without a database, in a SQLite file (AUTH_DB, default data/auth.db).
// - `misconfigured`: Neon Auth set but something it needs is missing; every request is refused
//   rather than falling back to a weaker gate.

export type AuthMode =
  | { kind: 'local' }
  | { kind: 'neon'; baseUrl: string; cookieSecret: string }
  | { kind: 'misconfigured'; missing: string[] };

// Neon Auth's SDK refuses shorter cookie secrets.
const MIN_SECRET_LENGTH = 32;

export function authMode(env: Record<string, string | undefined> = process.env): AuthMode {
  const baseUrl = env.NEON_AUTH_BASE_URL;
  if (!baseUrl) return { kind: 'local' };
  const cookieSecret = env.NEON_AUTH_COOKIE_SECRET ?? '';
  const missing = [
    ...(cookieSecret.length < MIN_SECRET_LENGTH ? ['NEON_AUTH_COOKIE_SECRET'] : []),
    ...(env.DATABASE_URL ? [] : ['DATABASE_URL']),
  ];
  return missing.length > 0 ? { kind: 'misconfigured', missing } : { kind: 'neon', baseUrl, cookieSecret };
}
