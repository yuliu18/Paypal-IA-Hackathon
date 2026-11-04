import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SettingsForm } from '@/lib/settings/settings';

const form: SettingsForm = {
  name: 'Acme Mugs',
  contactEmails: 'help@acme.test',
  refundPolicy: 'Refund an order only when it arrived damaged, defective or never arrived.',
  currency: 'USD',
  autoRefundUpTo: '100.00',
  approvalUpTo: '250.00',
  dailyCap: '200.00',
  provider: 'opencode-go',
  baseUrl: 'https://llm.test/v1',
  agentModel: 'model-a',
  judgeModel: '',
  apiKey: '',
  paypalClientId: 'client',
  paypalSecret: '',
};
type Saved = { ok: true } | { ok: false; errors: Record<string, string> };
const saveSettings = vi.fn<(form: SettingsForm) => Promise<Saved>>(async () => ({ ok: true }));
vi.mock('@/lib/settings/settings', async (original) => ({
  ...(await original<typeof import('@/lib/settings/settings')>()),
  loadSettings: async () => ({ ai: {} }),
  settingsView: async () => ({ locked: false, form }),
  saveSettings: (f: SettingsForm) => saveSettings(f),
}));
vi.mock('@/lib/agent/handle-ticket', () => ({
  llmConfig: async () => ({ baseUrl: 'https://llm.test/v1', apiKey: 'sk-test', agentModel: 'model-a', headers: {}, timeouts: { agentStepMs: 60_000, agentTicketMs: 90_000, judgeMs: 15_000, assistantMs: 30_000, documentsMs: 150_000 } }),
}));
const requestCompletion = vi.fn();
vi.mock('@/lib/llm/openai-compatible', () => ({ requestCompletion: (...args: unknown[]) => requestCompletion(...args) }));
vi.mock('next/headers', () => ({ headers: async () => new Headers({ 'x-forwarded-for': '10.0.0.9' }) }));
vi.mock('next/cache', () => ({ refresh: () => {} }));
vi.mock('next-intl/server', () => ({ getTranslations: async () => (key: string) => key }));

const { applyRulesAction, proposeRulesAction } = await import('./document-rules-actions');

const DOCUMENT = 'Our handbook. We never refund more than 150 dollars for a single order.';

describe('proposeRulesAction', () => {
  afterEach(() => requestCompletion.mockReset());

  it("proposes rules with the shop's model and today's settings, saving nothing", async () => {
    requestCompletion.mockResolvedValue({
      content: JSON.stringify({ proposals: [{ field: 'approvalUpTo', value: '150', quote: 'We never refund more than 150 dollars' }] }),
    });

    const result = await proposeRulesAction(DOCUMENT);

    expect(result).toEqual({
      ok: true,
      proposals: [{ field: 'approvalUpTo', current: '250.00', proposed: '150.00', quote: 'We never refund more than 150 dollars', effect: 'tightens' }],
    });
    const [config, body] = requestCompletion.mock.calls[0];
    expect(config).toEqual(expect.objectContaining({ model: 'model-a', timeoutMs: 150_000 }));
    expect(body).not.toHaveProperty('tools');
    expect(saveSettings).not.toHaveBeenCalled();
  });

  it('answers with a generic error when the model fails, keeping the details out of the page', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    requestCompletion.mockRejectedValue(new Error('LLM 401: bad key sk-secret'));

    expect(await proposeRulesAction(DOCUMENT)).toEqual({ ok: false, error: 'documents.failed' });
    expect(error).toHaveBeenCalled();
    error.mockRestore();
  });

  it('says so when the model takes too long', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    requestCompletion.mockRejectedValue(new DOMException('The operation was aborted due to timeout', 'TimeoutError'));

    expect(await proposeRulesAction(DOCUMENT)).toEqual({ ok: false, error: 'documents.timeout' });
    error.mockRestore();
  });

  it('refuses an empty document without calling the model', async () => {
    expect(await proposeRulesAction('  ')).toEqual({ ok: false, error: 'documents.empty' });
    expect(requestCompletion).not.toHaveBeenCalled();
  });
});

describe('applyRulesAction', () => {
  beforeEach(() => saveSettings.mockClear());
  afterEach(() => vi.unstubAllEnvs());

  it('saves only the chosen rules over the current settings, through the settings checks', async () => {
    const result = await applyRulesAction([
      { field: 'approvalUpTo', value: '150.00' },
      { field: 'refundPolicy', value: 'Refund within 30 days when the item arrived broken.' },
    ]);

    expect(result).toEqual({ ok: true });
    expect(saveSettings).toHaveBeenCalledWith({ ...form, approvalUpTo: '150.00', refundPolicy: 'Refund within 30 days when the item arrived broken.' });
  });

  it('ignores fields that are not rules a document may set', async () => {
    await applyRulesAction([{ field: 'apiKey', value: 'sk-evil' } as never, { field: 'dailyCap', value: '150' }]);

    expect(saveSettings).toHaveBeenCalledWith({ ...form, dailyCap: '150' });
  });

  it("passes on the settings' refusal, e.g. automatic refunds above the approval limit", async () => {
    saveSettings.mockResolvedValueOnce({ ok: false, errors: { autoRefundUpTo: 'Automatic refunds must stay within the approval limit.' } });

    expect(await applyRulesAction([{ field: 'autoRefundUpTo', value: '300' }])).toEqual({
      ok: false,
      error: 'Automatic refunds must stay within the approval limit.',
    });
  });

  it('refuses on a locked server', async () => {
    vi.stubEnv('SETTINGS_LOCKED', 'true');

    expect(await applyRulesAction([{ field: 'dailyCap', value: '150' }])).toEqual({ ok: false, error: 'lockedError' });
    expect(saveSettings).not.toHaveBeenCalled();
  });

  it('refuses an empty choice', async () => {
    expect(await applyRulesAction([])).toEqual({ ok: false, error: 'documents.noneChosen' });
    expect(saveSettings).not.toHaveBeenCalled();
  });
});
