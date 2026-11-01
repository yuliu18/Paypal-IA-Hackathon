import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Db } from '@/lib/db/db';
import { migrate } from '@/lib/db/migrations';
import { createPgliteDb } from '@/lib/db/pglite';
import { createPostgresSettingsStore } from './postgres-store';
import { loadSettings, saveSettings, settingsView, type SettingsForm } from './settings';

// The settings on Postgres (schema `guard`, one row per installation), as when DATABASE_URL is set:
// the same validation and key sealing as the file, on an in-process Postgres.

const SECRET = 'a-long-settings-secret-for-tests';
const ENV = { SETTINGS_SECRET: SECRET };

const form = (changes: Partial<SettingsForm> = {}): SettingsForm => ({
  name: 'Casa Mugs',
  contactEmails: 'hola@casamugs.example',
  refundPolicy: 'Refund damaged or lost orders of the customer who wrote, up to what was paid.',
  currency: 'EUR',
  autoRefundUpTo: '50',
  approvalUpTo: '300.50',
  dailyCap: '500',
  provider: 'deepseek',
  baseUrl: 'https://api.deepseek.com/v1',
  agentModel: 'deepseek-chat',
  judgeModel: '',
  apiKey: 'sk-deepseek-abcd1234',
  paypalClientId: 'shop-client',
  paypalSecret: 'shop-paypal-secret-5678',
  webhookUrl: '',
  ...changes,
});

let db: Db;
beforeEach(async () => {
  db = await createPgliteDb();
  await migrate(db);
});
afterEach(() => db.close());

const stored = async () => (await db.query<{ installation: string; data: string }>('SELECT installation, data FROM guard.settings')).rows;

describe('settings on Postgres', () => {
  it('saves one row for the installation and reads it back, keys sealed', async () => {
    const store = createPostgresSettingsStore(db);
    expect(await saveSettings(form(), { store, env: ENV })).toEqual({ ok: true });
    expect(await saveSettings(form({ name: 'Casa Mugs 2', apiKey: '', paypalSecret: '' }), { store, env: ENV })).toEqual({ ok: true });
    const rows = await stored();
    expect(rows.map((r) => r.installation)).toEqual(['default']);
    expect(rows[0].data).not.toContain('sk-deepseek');
    const settings = await loadSettings({ store, env: ENV });
    expect(settings.business.name).toBe('Casa Mugs 2');
    expect([settings.ai.apiKey, settings.paypal.secret]).toEqual(['sk-deepseek-abcd1234', 'shop-paypal-secret-5678']);
  });

  it('applies the same validation and saves nothing on an error', async () => {
    const store = createPostgresSettingsStore(db);
    const result = await saveSettings(form({ name: '' }), { store, env: ENV });
    expect(result).toEqual({ ok: false, errors: { name: 'Enter the business name.' } });
    expect(await stored()).toEqual([]);
  });

  it('without SETTINGS_SECRET, seals keys with a generated key kept in the database, so a restart still opens them', async () => {
    expect(await saveSettings(form(), { store: createPostgresSettingsStore(db), env: {} })).toEqual({ ok: true });
    const keys = (await db.query<{ key: string }>('SELECT key FROM guard.settings_key')).rows;
    expect(keys).toHaveLength(1);
    expect(keys[0].key.length).toBeGreaterThanOrEqual(16);
    // A new process: a new store on the same database.
    const settings = await loadSettings({ store: createPostgresSettingsStore(db), env: {} });
    expect(settings.ai.apiKey).toBe('sk-deepseek-abcd1234');
    expect((await settingsView({ store: createPostgresSettingsStore(db), env: {} })).ai.apiKey.source).toBe('saved');
  });

  it('keeps no generated key when SETTINGS_SECRET is set, or when no key is saved', async () => {
    await saveSettings(form(), { store: createPostgresSettingsStore(db), env: ENV });
    await saveSettings(form({ apiKey: '', paypalSecret: '' }), { store: createPostgresSettingsStore(db, { installation: 'other' }), env: {} });
    expect((await db.query('SELECT key FROM guard.settings_key')).rows).toEqual([]);
  });

  it('ignores a stored section in the wrong shape, as with the file', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    await db.query(`INSERT INTO guard.settings (installation, data) VALUES ('default', $1)`, [JSON.stringify({ business: { name: 7 } })]);
    expect((await loadSettings({ store: createPostgresSettingsStore(db), env: ENV })).business.name).toBe('Demo shop');
    expect(error).toHaveBeenCalled();
    error.mockRestore();
  });
});

describe('choosing where the settings live', () => {
  it('keeps the file when SETTINGS_FILE is set, even with DATABASE_URL, and never opens the database', async () => {
    const { mkdtemp, rm } = await import('node:fs/promises');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const dir = await mkdtemp(join(tmpdir(), 'settings-choice-'));
    try {
      // An address nothing listens on: reaching for it would fail the save.
      const env = { ...ENV, DATABASE_URL: 'postgres://nobody@127.0.0.1:1/none', SETTINGS_FILE: join(dir, 'settings.json') };
      expect(await saveSettings(form({ name: 'File shop' }), { env })).toEqual({ ok: true });
      expect((await loadSettings({ env })).business.name).toBe('File shop');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
