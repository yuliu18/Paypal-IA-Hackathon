// Sets a new random password for the built-in owner account and signs it out everywhere: the way
// back in when the owner forgot the password and Neon Auth is not used. Run it on the server, with
// the same DATABASE_URL or AUTH_DB as the app; the password is printed once, here only.
// Run with: npm run owner:reset   (reads .env.local when present)

import { getDb } from '../lib/db/client.ts';
import { localAuthStore } from '../lib/auth/local-store.ts';
import { resetLocalOwnerPassword } from '../lib/auth/owner-reset.ts';

if (process.env.NEON_AUTH_BASE_URL) {
  console.error('This installation signs in with Neon Auth: use "Forgot your password?" on the login page instead.');
  process.exit(1);
}

const store = localAuthStore();
try {
  const result = await resetLocalOwnerPassword(store);
  if (result.kind === 'no-owner') {
    console.log('There is no owner account yet: open the app and create it on the login page. Nothing was changed.');
  } else {
    console.log(`New password for ${result.email}:\n\n  ${result.password}\n\nIt is shown only this once. Every session was signed out; sign in with it.`);
  }
} catch (error) {
  // The driver's message names the failing statement, never the connection string.
  console.error('The password could not be reset:', (error as Error).message);
  process.exitCode = 1;
} finally {
  store.close?.();
  await getDb()?.close();
}
