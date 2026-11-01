// The settings in Postgres: one row per installation in <guard>.settings, holding the same JSON the
// file holds (keys already sealed by ./secret-box), and the generated sealing key, when
// SETTINGS_SECRET is not set, in <guard>.settings_key. Like settings.key beside the file, that key
// protects a copied settings row, not a copied database; SETTINGS_SECRET protects both.

import { randomBytes } from 'node:crypto';
import { schemaName, type Db } from '../db/db.ts';
import type { SettingsStore } from './store.ts';

export function createPostgresSettingsStore(db: Db, { schema = 'guard', installation = 'default' } = {}): SettingsStore {
  const s = schemaName(schema);
  return {
    where: `${s}.settings (${installation})`,
    keyLabel: `the generated settings key (${s}.settings_key)`,
    async read() {
      const { rows } = await db.query<{ data: string }>(`SELECT data FROM ${s}.settings WHERE installation = $1`, [installation]);
      return rows[0]?.data;
    },
    async write(json) {
      await db.query(
        `INSERT INTO ${s}.settings (installation, data, updated_at) VALUES ($1, $2, now())
         ON CONFLICT (installation) DO UPDATE SET data = EXCLUDED.data, updated_at = now()`,
        [installation, json],
      );
    },
    async readKey() {
      try {
        const { rows } = await db.query<{ key: string }>(`SELECT key FROM ${s}.settings_key WHERE installation = $1`, [installation]);
        const key = rows[0]?.key?.trim() ?? '';
        return key.length >= 16 ? key : '';
      } catch (error) {
        console.error('The generated settings key could not be read', error);
        return 'unreadable';
      }
    },
    async createKey() {
      // A key too short to use (edited by hand) can't have sealed anything, so it is replaced; a
      // usable one another process inserted first is kept.
      await db.query(
        `INSERT INTO ${s}.settings_key (installation, key) VALUES ($1, $2)
         ON CONFLICT (installation) DO UPDATE SET key = EXCLUDED.key WHERE length(trim(${s}.settings_key.key)) < 16`,
        [installation, randomBytes(32).toString('hex')],
      );
    },
  };
}
