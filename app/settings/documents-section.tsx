'use client';

import { useState, useTransition } from 'react';
import { useTranslations } from 'next-intl';
import type { RuleEffect, RuleField, RuleProposal } from '@/lib/settings/document-rules';
import { applyRulesAction, proposeRulesAction } from './document-rules-actions';
import { primaryButton, secondaryButton, Spinner } from '../ui/desk';

// The browser's copy of lib/settings/document-rules.ts DOCUMENT_MAX_CHARS (that module is server-only).
const MAX_CHARS = 50_000;

const input =
  'w-full rounded-md border border-pp-border bg-pp-surface px-3 py-2 text-sm leading-relaxed text-pp-ink focus:border-pp-blue focus:outline-none disabled:bg-pp-canvas disabled:text-pp-muted';

const LABELS: Record<RuleField, string> = {
  refundPolicy: 'business.refundPolicy',
  autoRefundUpTo: 'limits.autoRefundUpTo',
  approvalUpTo: 'limits.approvalUpTo',
  dailyCap: 'limits.dailyCap',
};

const BADGE: Record<RuleEffect, string> = {
  tightens: 'border-pp-success/40 bg-pp-success-tint text-pp-success',
  loosens: 'border-pp-danger/40 bg-pp-danger-tint text-pp-danger',
  changes: 'border-pp-warning/40 bg-pp-warning-tint text-pp-warning',
};

// Settings › From your documents: the owner pastes or loads the shop's documents, the model proposes
// rules from them (each with the sentence it comes from), and only the ones the owner ticks are saved.
// Tightening proposals start ticked; loosening ones and a new refund policy start unticked, with a warning.
export function DocumentsSection({ hidden, locked, currency }: { hidden: boolean; locked: boolean; currency: string }) {
  const t = useTranslations('settings');
  const [document, setDocument] = useState('');
  const [proposals, setProposals] = useState<RuleProposal[] | null>(null);
  const [chosen, setChosen] = useState<Set<RuleField>>(new Set());
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [reading, startReading] = useTransition();
  const [applying, startApplying] = useTransition();

  async function load(file: File | undefined) {
    if (!file) return;
    const text = await file.text();
    setDocument((previous) => (previous.trim() ? `${previous}\n\n${text}` : text));
  }

  function propose() {
    setMessage(null);
    startReading(async () => {
      const result = await proposeRulesAction(document);
      if (!result.ok) {
        setProposals(null);
        setMessage({ ok: false, text: result.error });
        return;
      }
      setProposals(result.proposals);
      setChosen(new Set(result.proposals.filter((p) => p.effect === 'tightens').map((p) => p.field)));
    });
  }

  function apply() {
    setMessage(null);
    const choices = (proposals ?? []).filter((p) => chosen.has(p.field)).map((p) => ({ field: p.field, value: p.proposed }));
    startApplying(async () => {
      const result = await applyRulesAction(choices);
      if (!result.ok) {
        setMessage({ ok: false, text: result.error });
        return;
      }
      setProposals((previous) => (previous ?? []).filter((p) => !chosen.has(p.field)));
      setChosen(new Set());
      setMessage({ ok: true, text: t('documents.applied', { count: choices.length }) });
    });
  }

  const toggle = (field: RuleField) =>
    setChosen((previous) => {
      const next = new Set(previous);
      if (next.has(field)) next.delete(field);
      else next.add(field);
      return next;
    });

  const shown = (p: RuleProposal, value: string) => (p.field === 'refundPolicy' ? value : `${value} ${currency}`);

  return (
    <section id="settings-documents" hidden={hidden} className="rounded-lg border border-pp-border bg-pp-surface p-6">
      <h2 className="text-lg font-semibold">{t('documents.title')}</h2>
      <p className="mt-1 max-w-2xl text-sm leading-relaxed text-pp-muted">{t('documents.detail')}</p>

      <label className="mt-5 block text-sm font-semibold" htmlFor="rules-document">
        {t('documents.label')}
      </label>
      <textarea
        id="rules-document"
        value={document}
        onChange={(e) => setDocument(e.target.value)}
        rows={10}
        maxLength={MAX_CHARS}
        placeholder={t('documents.placeholder')}
        className={`${input} mt-1.5`}
      />
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <button type="button" onClick={propose} disabled={reading || !document.trim()} className={primaryButton}>
          {reading && <Spinner />}
          {reading ? t('documents.reading') : t('documents.propose')}
        </button>
        <label className={`${secondaryButton} cursor-pointer`}>
          {t('documents.load')}
          <input type="file" accept=".txt,.md,.markdown,text/plain,text/markdown" multiple className="sr-only" onChange={(e) => {
            const files = [...(e.target.files ?? [])];
            e.target.value = '';
            files.reduce((done, file) => done.then(() => load(file)), Promise.resolve());
          }} />
        </label>
        <span className="text-xs text-pp-muted">{reading ? t('documents.readingHint') : t('documents.formats', { count: document.length.toLocaleString('en'), max: MAX_CHARS.toLocaleString('en') })}</span>
      </div>

      {proposals && (
        <div className="mt-6">
          <h3 className="font-semibold">{t('documents.proposalsTitle')}</h3>
          {proposals.length === 0 ? (
            <p className="mt-2 text-sm text-pp-muted">{t('documents.none')}</p>
          ) : (
            <>
              <ul className="mt-3 divide-y divide-pp-gridline overflow-hidden rounded-lg border border-pp-border">
                {proposals.map((p) => (
                  <li key={p.field} className="px-4 py-4">
                    <label className="flex items-start gap-3">
                      <input type="checkbox" checked={chosen.has(p.field)} onChange={() => toggle(p.field)} disabled={locked} className="mt-1 accent-pp-blue" />
                      <span className="min-w-0 flex-1">
                        <span className="flex flex-wrap items-center gap-2">
                          <span className="font-semibold">{t(LABELS[p.field])}</span>
                          <span className={`rounded-[3px] border px-2 py-0.5 text-xs font-semibold ${BADGE[p.effect]}`}>{t(`documents.effect.${p.effect}`)}</span>
                        </span>
                        {p.field === 'refundPolicy' ? (
                          <span className="mt-2 grid gap-2 text-sm sm:grid-cols-2">
                            <span className="whitespace-pre-wrap rounded border border-pp-border bg-pp-canvas p-2 text-pp-muted">{p.current}</span>
                            <span className="whitespace-pre-wrap rounded border border-pp-border p-2">{p.proposed}</span>
                          </span>
                        ) : (
                          <span className="mt-1 block text-sm">
                            <span className="text-pp-muted line-through">{shown(p, p.current)}</span> → <span className="font-semibold">{shown(p, p.proposed)}</span>
                          </span>
                        )}
                        <span className="mt-2 block border-l-2 border-pp-border pl-3 text-sm italic text-pp-muted">“{p.quote}”</span>
                        {p.effect !== 'tightens' && <span className="mt-2 block text-xs text-pp-danger">{t(`documents.warning.${p.effect}`)}</span>}
                      </span>
                    </label>
                  </li>
                ))}
              </ul>
              <div className="mt-4 flex flex-wrap items-center gap-3">
                <button type="button" onClick={apply} disabled={locked || applying || chosen.size === 0} className={primaryButton}>
                  {applying && <Spinner />}
                  {applying ? t('documents.applying') : t('documents.apply', { count: chosen.size })}
                </button>
                <span className="text-sm text-pp-muted">{t('documents.applyScope')}</span>
              </div>
            </>
          )}
        </div>
      )}
      {message && <p className={`mt-4 text-sm ${message.ok ? 'text-pp-success' : 'text-pp-danger'}`}>{message.text}</p>}
    </section>
  );
}
