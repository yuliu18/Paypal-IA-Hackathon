'use client';

import { startTransition, useActionState, useRef, useState, useTransition } from 'react';
import type { KeyStatus, SettingsForm, SettingsView } from '@/lib/settings/settings';
import type { Provider } from '@/lib/settings/providers';
import { saveSettingsAction, testAiAction, testPayPalAction } from './actions';

type Check = { ok: boolean; message: string } | null;

const input =
  'w-full rounded border border-pp-border bg-pp-surface px-3 py-2 text-sm text-pp-ink focus:border-pp-blue focus:outline-none disabled:bg-pp-canvas disabled:text-pp-muted';
const button =
  'rounded border border-pp-border bg-pp-surface px-3 py-1.5 text-sm font-semibold text-pp-navy hover:bg-pp-highlight disabled:opacity-60';

function Section({ title, detail, children }: { title: string; detail: string; children: React.ReactNode }) {
  return (
    <section className="rounded-lg border border-pp-border bg-pp-surface p-6">
      <h2 className="text-lg font-semibold text-pp-navy">{title}</h2>
      <p className="mt-1 text-sm text-pp-muted">{detail}</p>
      <div className="mt-5 grid gap-4 sm:grid-cols-2">{children}</div>
    </section>
  );
}

function Field({ label, error, hint, wide, children }: { label: string; error?: string; hint?: React.ReactNode; wide?: boolean; children: React.ReactNode }) {
  return (
    <label className={`block text-sm ${wide ? 'sm:col-span-2' : ''}`}>
      <span className="mb-1 block font-semibold text-pp-ink">{label}</span>
      {children}
      {hint && !error && <span className="mt-1 block text-xs text-pp-muted">{hint}</span>}
      {error && <span className="mt-1 block text-xs text-pp-danger">{error}</span>}
    </label>
  );
}

function keyHint(status: KeyStatus, canStoreKeys: boolean, variable: string) {
  const current = {
    saved: `Saved key ${status.hint}. Leave blank to keep it.`,
    env: `Using ${variable} from the server environment (${status.hint}). Leave blank to keep it.`,
    unreadable: 'The saved key cannot be read any more (SETTINGS_SECRET changed). Enter it again.',
    none: 'No key yet.',
  }[status.source];
  return canStoreKeys ? current : `${current} To store keys here, set SETTINGS_SECRET on the server.`;
}

function CheckResult({ check }: { check: Check }) {
  return check && <span className={`text-sm ${check.ok ? 'text-pp-success' : 'text-pp-danger'}`}>{check.message}</span>;
}

// The shop owner's settings: business, refund limits, AI provider and PayPal. Keys are write-only:
// the page only ever receives their last 4 characters.
export function SettingsEditor({ view, providers }: { view: SettingsView; providers: Provider[] }) {
  const formRef = useRef<HTMLFormElement>(null);
  const [state, save, saving] = useActionState(saveSettingsAction, null);
  const [provider, setProvider] = useState(view.form.provider);
  const [baseUrl, setBaseUrl] = useState(view.form.baseUrl);
  const [models, setModels] = useState<string[]>([]);
  const [aiCheck, setAiCheck] = useState<Check>(null);
  const [payPalCheck, setPayPalCheck] = useState<Check>(null);
  const [testing, startTesting] = useTransition();
  const errors: Partial<Record<keyof SettingsForm | 'form', string>> = state && !state.ok ? state.errors : {};
  const defaults = view.form;

  function chooseProvider(id: string) {
    setProvider(id);
    const preset = providers.find((p) => p.id === id);
    if (preset) setBaseUrl(preset.baseUrl);
    setModels([]);
    setAiCheck(null);
  }

  function testAi() {
    startTesting(async () => {
      const result = await testAiAction(new FormData(formRef.current!));
      setModels(result.ok ? result.models : []);
      if (!result.ok) return setAiCheck({ ok: false, message: result.error });
      setAiCheck({ ok: true, message: result.models.length ? `Connected: ${result.models.length} models to choose from.` : 'Connected with the agent model.' });
    });
  }

  function testPayPalConnection() {
    startTesting(async () => {
      const result = await testPayPalAction(new FormData(formRef.current!));
      setPayPalCheck(result.ok ? { ok: true, message: 'Connected to PayPal sandbox.' } : { ok: false, message: result.error });
    });
  }

  // Submitted by hand so a rejected form keeps what the owner typed.
  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    startTransition(() => save(data));
  }

  const groups = ['Global', 'China', 'Gateway', 'Local'] as const;

  return (
    <main className="mx-auto w-full max-w-4xl p-8 font-paypal text-pp-ink">
      <h1 className="text-[28px] font-semibold text-pp-navy">Settings</h1>
      <p className="mt-1 text-pp-muted">Adapt the support agent and its payment guard to your business. Changes apply to the next ticket.</p>
      {view.locked && (
        <p className="mt-4 rounded border border-pp-warning bg-pp-surface p-3 text-sm text-pp-warning">
          Read-only: this server sets SETTINGS_LOCKED, so the public demo&apos;s keys and limits can&apos;t be changed.
        </p>
      )}

      <form ref={formRef} onSubmit={submit} className="mt-6">
        <fieldset disabled={view.locked} className="space-y-6">
          <Section title="Business" detail="Who the agent works for and the refund policy it follows. The guard's judge checks every refund against this policy.">
            <Field label="Business name" error={errors.name}>
              <input name="name" defaultValue={defaults.name} className={input} />
            </Field>
            <Field label="Contact emails" error={errors.contactEmails} hint="The only addresses besides the customer's that replies may include.">
              <input name="contactEmails" defaultValue={defaults.contactEmails} placeholder="help@yourshop.com" className={input} />
            </Field>
            <Field label="Refund policy" error={errors.refundPolicy} wide>
              <textarea name="refundPolicy" defaultValue={defaults.refundPolicy} rows={4} className={input} />
            </Field>
          </Section>

          <Section title="Limits" detail="Enforced by the guard whatever the AI decides: no prompt can raise them.">
            <Field label="Currency" error={errors.currency}>
              <input name="currency" defaultValue={defaults.currency} maxLength={3} className={`${input} uppercase`} />
            </Field>
            <Field label="Refund automatically up to" error={errors.autoRefundUpTo} hint="Smaller refunds run on their own.">
              <input name="autoRefundUpTo" defaultValue={defaults.autoRefundUpTo} inputMode="decimal" className={input} />
            </Field>
            <Field label="Ask a person up to" error={errors.approvalUpTo} hint="Larger refunds wait on /guard; above this they are blocked.">
              <input name="approvalUpTo" defaultValue={defaults.approvalUpTo} inputMode="decimal" className={input} />
            </Field>
            <Field label="Daily cap" error={errors.dailyCap} hint="Total the agent may refund per day.">
              <input name="dailyCap" defaultValue={defaults.dailyCap} inputMode="decimal" className={input} />
            </Field>
          </Section>

          <Section title="AI" detail="Any provider with an OpenAI-compatible API: cloud, Chinese or running on your own machine.">
            <Field label="Provider">
              <select name="provider" value={provider} onChange={(e) => chooseProvider(e.target.value)} className={input}>
                {groups.map((group) => (
                  <optgroup key={group} label={group}>
                    {providers
                      .filter((p) => p.group === group)
                      .map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.label}
                        </option>
                      ))}
                  </optgroup>
                ))}
                <option value="custom">Custom (any OpenAI-compatible URL)</option>
              </select>
            </Field>
            <Field label="Base URL" error={errors.baseUrl}>
              <input name="baseUrl" value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} readOnly={provider !== 'custom'} className={input} />
            </Field>
            <Field label="API key" error={errors.apiKey} hint={keyHint(view.ai.apiKey, view.canStoreKeys, 'LLM_API_KEY')} wide>
              <input name="apiKey" type="password" autoComplete="off" disabled={!view.canStoreKeys} placeholder={view.ai.apiKey.hint} className={input} />
            </Field>
            {view.ai.apiKey.source === 'saved' && (
              <label className="flex items-center gap-2 text-sm sm:col-span-2">
                <input type="checkbox" name="clearApiKey" /> Remove the saved key
              </label>
            )}
            <Field label="Agent model" error={errors.agentModel} hint="Answers the tickets and calls PayPal tools.">
              <input name="agentModel" defaultValue={defaults.agentModel} list="models" className={input} />
            </Field>
            <Field label="Judge model" error={errors.judgeModel} hint="Checks each refund against the policy. Blank: same as the agent.">
              <input name="judgeModel" defaultValue={defaults.judgeModel} list="models" className={input} />
            </Field>
            <datalist id="models">
              {models.map((model) => (
                <option key={model} value={model} />
              ))}
            </datalist>
            <div className="flex items-center gap-3 sm:col-span-2">
              <button type="button" onClick={testAi} disabled={testing} className={button}>
                Test connection
              </button>
              <CheckResult check={aiCheck} />
            </div>
          </Section>

          <Section title="PayPal" detail="Sandbox REST app credentials from developer.paypal.com. Money in the sandbox is fictitious.">
            <Field label="Client ID" error={errors.paypalClientId}>
              <input name="paypalClientId" defaultValue={defaults.paypalClientId} autoComplete="off" className={input} />
            </Field>
            <Field label="Secret" error={errors.paypalSecret} hint={keyHint(view.paypal.secret, view.canStoreKeys, 'PAYPAL_SECRET')}>
              <input name="paypalSecret" type="password" autoComplete="off" disabled={!view.canStoreKeys} placeholder={view.paypal.secret.hint} className={input} />
            </Field>
            {view.paypal.secret.source === 'saved' && (
              <label className="flex items-center gap-2 text-sm sm:col-span-2">
                <input type="checkbox" name="clearPaypalSecret" /> Remove the saved secret
              </label>
            )}
            <div className="flex items-center gap-3 sm:col-span-2">
              <button type="button" onClick={testPayPalConnection} disabled={testing} className={button}>
                Test connection
              </button>
              <CheckResult check={payPalCheck} />
            </div>
          </Section>

          <div className="flex items-center gap-4">
            <button type="submit" disabled={saving} className="rounded bg-pp-blue px-5 py-2 font-semibold text-white hover:bg-pp-blue-dark disabled:opacity-60">
              {saving ? 'Saving…' : 'Save settings'}
            </button>
            {state?.ok && <span className="text-sm text-pp-success">Saved. The next ticket uses these settings.</span>}
            {errors.form && <span className="text-sm text-pp-danger">{errors.form}</span>}
            {state && !state.ok && !errors.form && <span className="text-sm text-pp-danger">Check the highlighted fields.</span>}
          </div>
        </fieldset>
      </form>
    </main>
  );
}
