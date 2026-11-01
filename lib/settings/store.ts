// Where the settings live. A JSON file by default (data/settings.json, see ./settings.ts), or a row in
// Postgres when DATABASE_URL is set (./postgres-store.ts), so they survive hosts without a disk.
// Both keep the generated key that seals saved keys when SETTINGS_SECRET is not set.

export type SettingsStore = {
  // Names the store in log messages.
  where: string;
  // Names the generated key in the error shown when it can't be used.
  keyLabel: string;
  // The saved JSON, undefined when nothing was saved; throws when it can't be read.
  read(): Promise<string | undefined>;
  write(json: string): Promise<void>;
  // The generated key, '' when there is none (or it is too short to be one), or 'unreadable'.
  readKey(): Promise<string>;
  // Creates the generated key unless a usable one exists; never replaces one another process made.
  createKey(): Promise<void>;
};
