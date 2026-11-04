'use server';

import { refresh } from 'next/cache';
import { headers } from 'next/headers';
import { getTranslations } from 'next-intl/server';
import { llmConfig } from '@/lib/agent/handle-ticket';
import { TicketLimiter } from '@/lib/agent/ticket-limiter';
import { clientAddress } from '@/lib/auth/failed-attempts';
import { requestCompletion } from '@/lib/llm/openai-compatible';
import { CLOUD_TIMEOUTS } from '@/lib/llm/timeouts';
import { DOCUMENT_MAX_CHARS, proposeRules, RULE_FIELDS, type RuleField, type RuleProposal } from '@/lib/settings/document-rules';
import { loadSettings, saveSettings, settingsView } from '@/lib/settings/settings';

// Settings › From your documents (lib/settings/document-rules.ts). Proposing reads a document with
// the shop's model and saves nothing; applying saves the rules the owner chose, through saveSettings
// like any edit on /settings. The proxy's owner sign-in covers both, like the page.

// Each reading spends LLM tokens: 10 per address per 10 minutes, one at a time, 2 at once overall.
const readings = new TicketLimiter({ perClient: 10, windowMs: 10 * 60_000, inFlightPerClient: 1, inFlight: 2 });

export type ProposeResult = { ok: true; proposals: RuleProposal[] } | { ok: false; error: string };
export type ApplyResult = { ok: true } | { ok: false; error: string };

export async function proposeRulesAction(document: string): Promise<ProposeResult> {
  const t = await getTranslations('settings');
  if (typeof document !== 'string' || !document.trim()) return { ok: false, error: t('documents.empty') };
  if (document.length > DOCUMENT_MAX_CHARS) return { ok: false, error: t('documents.tooLong', { max: DOCUMENT_MAX_CHARS.toLocaleString('en') }) };

  const slot = readings.acquire(clientAddress(await headers()), Date.now());
  if (!slot.ok) return { ok: false, error: t('documents.busy', { seconds: Math.ceil(slot.retryAfterMs / 1000) }) };
  let waitMs = CLOUD_TIMEOUTS.documentsMs;
  try {
    const [{ form }, settings] = await Promise.all([settingsView(), loadSettings()]);
    const llm = await llmConfig(settings.ai);
    waitMs = llm.timeouts.documentsMs;
    const config = { baseUrl: llm.baseUrl, apiKey: llm.apiKey, model: llm.agentModel, headers: llm.headers, timeoutMs: waitMs };
    const proposals = await proposeRules({
      document,
      current: { currency: form.currency, refundPolicy: form.refundPolicy, autoRefundUpTo: form.autoRefundUpTo, approvalUpTo: form.approvalUpTo, dailyCap: form.dailyCap },
      complete: (request) => requestCompletion(config, request),
    });
    return { ok: true, proposals };
  } catch (cause) {
    // The cause can carry provider responses or configuration names.
    console.error('Reading the document for rules failed', cause);
    const timedOut = cause instanceof Error && cause.name === 'TimeoutError';
    return { ok: false, error: timedOut ? t('documents.timeout', { minutes: waitMs / 60_000 }) : t('documents.failed') };
  } finally {
    slot.release();
  }
}

export async function applyRulesAction(choices: { field: RuleField; value: string }[]): Promise<ApplyResult> {
  const t = await getTranslations('settings');
  if (process.env.SETTINGS_LOCKED === 'true') return { ok: false, error: t('lockedError') };
  // Only the rules a document may set: anything else in the request is ignored.
  const chosen = (Array.isArray(choices) ? choices : []).filter(
    (c) => c && RULE_FIELDS.includes(c.field) && typeof c.value === 'string',
  );
  if (!chosen.length) return { ok: false, error: t('documents.noneChosen') };

  // Today's settings with the chosen rules on top: blank keys keep the saved ones, as on /settings.
  const { form } = await settingsView();
  const result = await saveSettings({ ...form, ...Object.fromEntries(chosen.map((c) => [c.field, c.value])) });
  if (!result.ok) return { ok: false, error: Object.values(result.errors).find(Boolean) ?? t('documents.failed') };
  refresh();
  return { ok: true };
}
