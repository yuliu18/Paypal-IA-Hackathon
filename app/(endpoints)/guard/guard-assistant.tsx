'use client';

// Ask the guard assistant (app/api/guard/assistant) about the guard's decisions. It only explains:
// its answer is shown as plain text and never turns into a link or an action. Approving and
// rejecting stay with the held queue above.

import { useState, type FormEvent } from 'react';
import { useTranslations } from 'next-intl';
import { ASSISTANT_MAX_QUESTION } from '@/lib/guard/assistant';
import { Spinner } from '../../ui/desk';

// Message keys (guard.assistant.suggestions) of the suggested questions.
const SUGGESTED = ['lastRefund', 'today', 'waiting', 'stoppedCustomers'] as const;

// React escapes the text, and nothing parses it as markdown or HTML.
export function AssistantAnswer({ answer }: { answer: string }) {
  return <p className="mt-3 max-w-3xl whitespace-pre-wrap text-sm text-pp-ink">{answer}</p>;
}

type Reply = { answer: string } | { error: string } | null;

export function GuardAssistant() {
  const t = useTranslations('guard.assistant');
  const [question, setQuestion] = useState('');
  const [reply, setReply] = useState<Reply>(null);
  const [pending, setPending] = useState(false);

  async function ask(event: FormEvent) {
    event.preventDefault();
    if (!question.trim() || pending) return;
    setPending(true);
    try {
      const res = await fetch('/api/guard/assistant', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question }),
      });
      const body = (await res.json().catch(() => ({}))) as { answer?: unknown; error?: { message?: unknown } };
      if (res.ok && typeof body.answer === 'string') setReply({ answer: body.answer });
      else setReply({ error: typeof body.error?.message === 'string' ? body.error.message : t('failed') });
    } catch {
      setReply({ error: t('unreachable') });
    } finally {
      setPending(false);
    }
  }

  return (
    <section className="rounded-lg border border-pp-border bg-pp-surface px-5 py-4">
      <h2 className="text-lg font-semibold">{t('title')}</h2>
      <p className="mt-1 text-sm text-pp-muted">
        {t('intro')}
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        {SUGGESTED.map((key) => t(`suggestions.${key}`)).map((suggestion) => (
          <button
            key={suggestion}
            type="button"
            onClick={() => setQuestion(suggestion)}
            className="rounded-md border border-pp-border px-2.5 py-1 text-left text-xs font-semibold text-pp-blue hover:border-pp-blue"
          >
            {suggestion}
          </button>
        ))}
      </div>
      <form onSubmit={ask} className="mt-3 flex flex-wrap gap-2">
        <input
          value={question}
          onChange={(event) => setQuestion(event.target.value)}
          maxLength={ASSISTANT_MAX_QUESTION}
          placeholder={t('placeholder')}
          aria-label={t('inputLabel')}
          className="min-w-0 flex-1 rounded-md border border-pp-border px-3 py-1.5 text-sm"
        />
        <button
          type="submit"
          disabled={pending || !question.trim()}
          className="inline-flex items-center gap-2 rounded-md bg-pp-blue px-4 py-1.5 text-sm font-semibold text-white hover:bg-pp-blue-dark disabled:opacity-60"
        >
          {pending && <Spinner />}
          {pending ? t('thinking') : t('ask')}
        </button>
      </form>
      {reply && ('answer' in reply ? <AssistantAnswer answer={reply.answer} /> : <p className="mt-3 text-sm text-pp-danger">{reply.error}</p>)}
    </section>
  );
}
