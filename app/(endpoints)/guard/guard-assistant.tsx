'use client';

// Ask the guard assistant (app/api/guard/assistant) about the guard's decisions. It only explains:
// its answer is shown as plain text and never turns into a link or an action. Approving and
// rejecting stay with the held queue above.

import { useState, type FormEvent } from 'react';
import { ASSISTANT_MAX_QUESTION } from '@/lib/guard/assistant';

const SUGGESTED = ['Why was the last refund blocked?', 'Summarise today', 'What is waiting for me?', 'Which customers were stopped most?'];

// React escapes the text, and nothing parses it as markdown or HTML.
export function AssistantAnswer({ answer }: { answer: string }) {
  return <p className="mt-3 max-w-3xl whitespace-pre-wrap text-sm text-pp-ink">{answer}</p>;
}

type Reply = { answer: string } | { error: string } | null;

export function GuardAssistant() {
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
      else setReply({ error: typeof body.error?.message === 'string' ? body.error.message : 'The guard assistant failed.' });
    } catch {
      setReply({ error: 'The guard assistant could not be reached.' });
    } finally {
      setPending(false);
    }
  }

  return (
    <section className="mt-5 rounded-lg border border-pp-border bg-pp-surface px-5 py-4">
      <h2 className="text-lg font-semibold text-pp-navy">Guard assistant</h2>
      <p className="mt-1 text-sm text-pp-muted">
        Ask about the guard&apos;s decisions. It reads the newest entries of the log, masked and without the tickets&apos; text, and can only explain:
        it can&apos;t approve, reject or change rules.
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        {SUGGESTED.map((suggestion) => (
          <button
            key={suggestion}
            type="button"
            onClick={() => setQuestion(suggestion)}
            className="rounded-full border border-pp-border px-3 py-1 text-xs font-semibold text-pp-blue hover:bg-pp-highlight"
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
          placeholder="Ask about the guard's decisions"
          aria-label="Question for the guard assistant"
          className="min-w-0 flex-1 rounded border border-pp-border px-3 py-1.5 text-sm"
        />
        <button
          type="submit"
          disabled={pending || !question.trim()}
          className="rounded bg-pp-blue px-4 py-1.5 text-sm font-semibold text-white hover:bg-pp-blue-dark disabled:opacity-50"
        >
          {pending ? 'Thinking…' : 'Ask'}
        </button>
      </form>
      {reply && ('answer' in reply ? <AssistantAnswer answer={reply.answer} /> : <p className="mt-3 text-sm text-pp-danger">{reply.error}</p>)}
    </section>
  );
}
