import { mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadSettings, saveSettings } from './settings';

// A disk without hard links: every link() fails as it does there.
vi.mock('node:fs/promises', async (original) => ({
  ...(await original<typeof import('node:fs/promises')>()),
  link: async () => {
    throw Object.assign(new Error('operation not permitted'), { code: 'EPERM' });
  },
}));

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'settings-nolink-'));
});
afterEach(() => rm(dir, { recursive: true, force: true }));

describe('saveSettings on a disk without hard links', () => {
  it('still creates the key file and stores the key', async () => {
    const file = join(dir, 'settings.json');
    const env = {};
    const form = {
      name: 'Shop', contactEmails: '', refundPolicy: 'Refund damaged orders of the ticket customer.', currency: 'USD',
      autoRefundUpTo: '100', approvalUpTo: '250', dailyCap: '200', provider: 'custom', baseUrl: 'https://llm.example/v1',
      agentModel: 'm', judgeModel: '', apiKey: 'sk-nolink-12345678', paypalClientId: '', paypalSecret: '',
    };
    expect(await saveSettings(form, { file, env })).toEqual({ ok: true });
    expect((await stat(join(dir, 'settings.key'))).mode & 0o777).toBe(0o600);
    expect((await loadSettings({ file, env })).ai.apiKey).toBe('sk-nolink-12345678');
  });
});
