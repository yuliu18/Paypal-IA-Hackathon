'use client';

import { startTransition, useActionState, useState, useSyncExternalStore, useTransition } from 'react';
import { useTranslations } from 'next-intl';
import type { ApiKeySummary } from '@/lib/apikeys/keys';
import { createApiKeyAction, revokeApiKeyAction, type ApiKeyError } from './api-key-actions';
import { primaryButton, Spinner } from '../ui/desk';

// What the page could read about the keys: none without DATABASE_URL, an error when the database
// didn't answer.
export type ApiKeysView = { state: 'unavailable' } | { state: 'unreadable' } | { state: 'ready'; keys: ApiKeySummary[] };

const input =
  'h-10 w-full rounded-md border border-pp-border bg-pp-surface px-3 py-2 text-sm text-pp-ink focus:border-pp-blue focus:outline-none disabled:bg-pp-canvas disabled:text-pp-muted';
const button =
  'rounded-md border border-pp-border bg-pp-surface px-3 py-1.5 text-sm font-semibold text-pp-ink hover:border-pp-blue disabled:opacity-60';
const code = 'block overflow-x-auto whitespace-pre rounded border border-pp-border bg-pp-canvas p-3 font-mono text-xs text-pp-ink';

const PLACEHOLDER_KEY = 'pg_your_key_here';
const curlExample = (origin: string) =>
  `curl -X POST ${origin}/api/support/tickets \\
  -H "Authorization: Bearer ${PLACEHOLDER_KEY}" \\
  -H "Content-Type: application/json" \\
  -d '{"customerEmail":"ana@example.com","message":"My mug arrived broken."}'`;

// "2026-11-01 10:00 UTC": the same on the server and in every browser.
const atUtc = (iso: string) => `${iso.slice(0, 16).replace('T', ' ')} UTC`;

const noSubscription = () => () => undefined;

function CopyButton({ text }: { text: string }) {
  const t = useTranslations('settings.apiKeys');
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className={button}
      onClick={() => {
        navigator.clipboard?.writeText(text).then(
          () => setCopied(true),
          () => setCopied(false),
        );
      }}
    >
      {copied ? t('copied') : t('copy')}
    </button>
  );
}

// Settings › API keys: the business's own app calls the agents with a key instead of signing in.
// Its own card, outside the settings form: creating or revoking a key saves at once.
export function ApiKeysSection({ hidden, view, locked }: { hidden: boolean; view: ApiKeysView; locked: boolean }) {
  const t = useTranslations('settings.apiKeys');
  const [created, create, creating] = useActionState(createApiKeyAction, null);
  const [revoking, startRevoking] = useTransition();
  const [revokeError, setRevokeError] = useState<ApiKeyError | null>(null);
  // The example names this site; the server, which can't know the address the browser used, shows a placeholder.
  const origin = useSyncExternalStore(noSubscription, () => window.location.origin, () => 'https://your-guard.example');
  const disabled = locked || view.state !== 'ready';

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    startTransition(() => create(data));
  }

  function revoke(key: ApiKeySummary) {
    if (!window.confirm(t('revokeConfirm', { name: key.name }))) return;
    setRevokeError(null);
    startRevoking(async () => {
      const result = await revokeApiKeyAction(key.id);
      if (!result.ok) setRevokeError(result.error);
    });
  }

  return (
    <section id="settings-api-keys" hidden={hidden} className="rounded-lg border border-pp-border bg-pp-surface p-6">
      <h2 className="text-lg font-semibold">{t('title')}</h2>
      <p className="mt-1 max-w-2xl text-sm leading-relaxed text-pp-muted">{t('detail')}</p>

      {view.state === 'unavailable' && (
        <p className="mt-5 rounded-lg border border-pp-warning/40 bg-pp-warning-tint px-4 py-3 text-sm text-pp-warning">{t('needsDatabase')}</p>
      )}
      {view.state === 'unreadable' && (
        <p className="mt-5 rounded-lg border border-pp-danger/40 px-4 py-3 text-sm text-pp-danger">{t('unreadable')}</p>
      )}

      <form onSubmit={submit} className="mt-5 flex flex-col gap-3 sm:flex-row sm:items-end">
        <label className="block min-w-0 flex-1 text-sm">
          <span className="mb-1 block font-semibold text-pp-ink">{t('name')}</span>
          <input name="name" required maxLength={60} autoComplete="off" placeholder={t('namePlaceholder')} disabled={disabled} className={input} />
        </label>
        <button type="submit" disabled={disabled || creating} className={`${primaryButton} shrink-0`}>
          {creating && <Spinner />}
          {creating ? t('creating') : t('create')}
        </button>
      </form>
      {created && !created.ok && <p className="mt-2 text-sm text-pp-danger">{t(`errors.${created.error}`)}</p>}

      {created?.ok && (
        <div className="mt-5 rounded-lg border border-pp-success/40 bg-pp-success-tint p-4">
          <p className="text-sm font-semibold text-pp-ink">{t('created', { name: created.summary.name })}</p>
          <div className="mt-2 flex flex-wrap items-center gap-3">
            <code className="min-w-0 break-all rounded border border-pp-border bg-pp-surface px-2 py-1 font-mono text-sm">{created.key}</code>
            <CopyButton text={created.key} />
          </div>
          <p className="mt-2 text-sm font-semibold text-pp-warning">{t('onceNote')}</p>
        </div>
      )}

      <h3 className="mt-6 font-semibold">{t('example')}</h3>
      <pre className={`mt-2 ${code}`}>{curlExample(origin)}</pre>
      <p className="mt-2 text-xs text-pp-muted">{t('scope')}</p>

      <h3 className="mt-6 font-semibold">{t('listTitle')}</h3>
      {view.state === 'ready' && view.keys.length === 0 && <p className="mt-2 text-sm text-pp-muted">{t('empty')}</p>}
      {view.state === 'ready' && view.keys.length > 0 && (
        <div className="mt-2 overflow-x-auto">
          <table className="w-full min-w-[36rem] text-left text-sm">
            <thead className="text-xs text-pp-muted">
              <tr>
                <th className="py-2 pr-3 font-semibold">{t('columns.name')}</th>
                <th className="py-2 pr-3 font-semibold">{t('columns.key')}</th>
                <th className="py-2 pr-3 font-semibold">{t('columns.created')}</th>
                <th className="py-2 pr-3 font-semibold">{t('columns.lastUsed')}</th>
                <th className="py-2 pr-3 font-semibold">{t('columns.status')}</th>
                <th className="py-2" />
              </tr>
            </thead>
            <tbody>
              {view.keys.map((key) => (
                <tr key={key.id} className="border-t border-pp-border">
                  <td className="py-2 pr-3 font-semibold wrap-anywhere">{key.name}</td>
                  <td className="py-2 pr-3 font-mono text-xs">pg_…{key.last4}</td>
                  <td className="py-2 pr-3 whitespace-nowrap">{atUtc(key.createdAt)}</td>
                  <td className="py-2 pr-3 whitespace-nowrap">{key.lastUsedAt ? atUtc(key.lastUsedAt) : t('never')}</td>
                  <td className="py-2 pr-3">
                    {key.revokedAt ? (
                      <span className="text-pp-muted">{t('revokedAt', { at: atUtc(key.revokedAt) })}</span>
                    ) : (
                      <span className="text-pp-success">{t('active')}</span>
                    )}
                  </td>
                  <td className="py-2 text-right">
                    {!key.revokedAt && (
                      <button type="button" onClick={() => revoke(key)} disabled={locked || revoking} className={`${button} text-pp-danger`}>
                        {t('revoke')}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {revokeError && <p className="mt-2 text-sm text-pp-danger">{t(`errors.${revokeError}`)}</p>}
    </section>
  );
}
