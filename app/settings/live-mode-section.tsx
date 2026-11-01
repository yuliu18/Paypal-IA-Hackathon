'use client';

import { useState, useTransition } from 'react';
import { useTranslations } from 'next-intl';
import type { LiveModeStatus } from '@/lib/settings/live-mode';
import type { LiveSwitchResult } from '@/lib/settings/live-switch';
import { turnOffLiveModeAction, turnOnLiveModeAction } from './live-mode-actions';
import { Spinner } from '../ui/desk';

// The word typed to confirm; the same in every language (lib/settings/live-mode.ts LIVE_CONFIRMATION_WORD).
const WORD = 'LIVE';

const input =
  'h-10 w-full rounded-md border border-pp-border bg-pp-surface px-3 py-2 text-sm text-pp-ink focus:border-pp-blue focus:outline-none';
const dangerButton =
  'inline-flex items-center gap-2 rounded-md bg-pp-danger px-4 py-2.5 text-sm font-semibold text-white hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50';
const button =
  'rounded-md border border-pp-border bg-pp-surface px-3 py-1.5 text-sm font-semibold text-pp-ink hover:border-pp-blue disabled:cursor-not-allowed disabled:opacity-60';

type Failure = Extract<LiveSwitchResult, { ok: false }>;

// Settings › PayPal app › Mode: Test or Live, saved at once, outside the settings form. Live needs
// the server's permission, a saved live app, the typed confirmation and a successful live token
// request (checked again on the server); Test is always one press away.
export function LiveModeSection({ hidden, status, locked }: { hidden: boolean; status: LiveModeStatus; locked: boolean }) {
  const t = useTranslations('settings.liveMode');
  const [dialogOpen, setDialogOpen] = useState(false);
  const [typed, setTyped] = useState('');
  const [failure, setFailure] = useState<Failure | null>(null);
  const [pending, startTransition] = useTransition();

  // Why Live can't be pressed now, if it can't.
  const blocked = locked ? 'locked' : !status.serverAllows ? 'server' : !status.liveApp ? 'app' : null;
  const errorText = (f: Failure) => (f.error === 'check' ? t('errors.check', { detail: f.detail ?? '' }) : t(`errors.${f.error}`, { word: WORD }));

  function openDialog() {
    setTyped('');
    setFailure(null);
    setDialogOpen(true);
  }

  function turnOn() {
    startTransition(async () => {
      const result = await turnOnLiveModeAction(typed);
      if (result.ok) setDialogOpen(false);
      else setFailure(result);
    });
  }

  function turnOff() {
    setFailure(null);
    startTransition(async () => {
      const result = await turnOffLiveModeAction();
      if (!result.ok) setFailure(result);
    });
  }

  const tab = (on: boolean) =>
    `rounded-md px-4 py-1.5 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-60 ${on ? 'bg-pp-surface text-pp-ink shadow-sm' : 'text-pp-muted hover:text-pp-ink'}`;

  return (
    <section id="settings-live-mode" hidden={hidden} className="mt-6 rounded-lg border border-pp-border bg-pp-surface p-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h2 className="text-lg font-semibold">{t('title')}</h2>
        <span
          className={`rounded-[3px] border px-2 py-0.5 text-xs font-semibold ${status.active ? 'border-pp-danger/40 bg-pp-danger-tint text-pp-danger' : 'border-pp-border bg-pp-canvas text-pp-muted'}`}
        >
          {status.active ? t('badge.live') : t('badge.test')}
        </span>
      </div>
      <p className="mt-1 max-w-2xl text-sm leading-relaxed text-pp-muted">{t('detail')}</p>

      <div role="radiogroup" aria-label={t('title')} className="mt-5 inline-flex gap-1 rounded-lg border border-pp-border bg-pp-canvas p-1">
        <button type="button" role="radio" aria-checked={status.mode === 'test'} className={tab(status.mode === 'test')} disabled={pending} onClick={() => status.mode === 'live' && turnOff()}>
          {t('test')}
        </button>
        <button type="button" role="radio" aria-checked={status.mode === 'live'} className={tab(status.mode === 'live')} disabled={pending || (status.mode !== 'live' && blocked !== null)} onClick={() => status.mode !== 'live' && openDialog()}>
          {t('live')}
        </button>
      </div>

      <p className="mt-3 max-w-2xl text-sm leading-relaxed">{status.active ? t('current.live') : t('current.test')}</p>
      {status.mode === 'live' && !status.active && (
        <p className="mt-3 max-w-2xl rounded border border-pp-warning/40 bg-pp-warning-tint px-3 py-2 text-sm text-pp-warning">
          {t('failClosed', { reason: t(`reasons.${status.serverAllows ? 'app' : 'server'}`) })}
        </p>
      )}
      {status.mode !== 'live' && blocked && <p className="mt-3 text-sm text-pp-muted">{t(`disabled.${blocked}`)}</p>}
      {status.mode === 'live' && (
        <p className="mt-3 text-sm text-pp-muted">{t('howBack')}</p>
      )}
      <p className="mt-3 max-w-2xl text-xs text-pp-muted">{t('dashboardNote')}</p>
      {failure && !dialogOpen && <p className="mt-3 text-sm text-pp-danger">{errorText(failure)}</p>}

      {dialogOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => !pending && setDialogOpen(false)}>
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="live-mode-dialog-title"
            className="w-full max-w-lg rounded-lg border border-pp-border bg-pp-surface p-6 shadow-xl"
            onClick={(event) => event.stopPropagation()}
          >
            <h3 id="live-mode-dialog-title" className="text-lg font-semibold">
              {t('dialog.title')}
            </h3>
            <p className="mt-3 rounded border border-pp-danger/40 bg-pp-danger-tint px-3 py-2 text-sm font-semibold text-pp-danger">{t('dialog.warning')}</p>
            <ul className="mt-4 list-disc space-y-1.5 pl-5 text-sm leading-relaxed text-pp-ink">
              <li>{t('dialog.money')}</li>
              <li>{t('dialog.scope')}</li>
              <li>{t('dialog.check')}</li>
              <li>{t('dialog.back')}</li>
            </ul>
            <label className="mt-5 block text-sm">
              <span className="mb-1 block font-semibold text-pp-ink">{t('dialog.confirmLabel', { word: WORD })}</span>
              <input value={typed} onChange={(event) => setTyped(event.target.value)} autoComplete="off" spellCheck={false} autoFocus className={input} />
            </label>
            {failure && <p className="mt-3 text-sm text-pp-danger">{errorText(failure)}</p>}
            <div className="mt-5 flex flex-wrap items-center justify-end gap-3">
              <button type="button" className={button} disabled={pending} onClick={() => setDialogOpen(false)}>
                {t('dialog.cancel')}
              </button>
              <button type="button" className={dangerButton} disabled={pending || typed.trim() !== WORD} onClick={turnOn}>
                {pending && <Spinner />}
                {pending ? t('dialog.checking') : t('dialog.confirm')}
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
