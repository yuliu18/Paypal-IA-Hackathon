import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: { alias: { '@': fileURLToPath(new URL('./', import.meta.url)) } },
  // Tests never read the settings a developer saved on /settings.
  test: { env: { SETTINGS_FILE: 'data/no-settings-in-tests.json' } },
});
