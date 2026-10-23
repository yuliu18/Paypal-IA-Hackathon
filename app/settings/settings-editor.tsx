'use client';

import { startTransition, useActionState, useRef, useState, useTransition } from 'react';
import type { KeyStatus, SettingsForm, SettingsView } from '@/lib/settings/settings';
import type { CatalogModel, CatalogProvider } from '@/lib/settings/catalog';
import { CURRENCIES } from '@/lib/settings/currencies';
import { catalogModelsAction, saveSettingsAction, testAiAction, testPayPalAction } from './actions';
import { Picker, type PickerOption } from './picker';
import { latestOnly } from './picker-logic';

type Check = { ok: boolean; message: string } | null;

// Every one-line field is h-10, so inputs and pickers line up.
const input =
  'h-10 w-full rounded border border-pp-border bg-pp-surface px-3 py-2 text-sm text-pp-ink focus:border-pp-blue focus:outline-none disabled:bg-pp-canvas disabled:text-pp-muted';
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

// `thing`: what the field holds, e.g. the webhook URL, which is kept as secret as a key.
function keyHint(status: KeyStatus, variable: string, thing = 'key') {
  return {
    saved: `Saved ${thing} ${status.hint}. Leave blank to keep it.`,
    env: `Using ${variable} from the server environment (${status.hint}). Leave blank to keep it.`,
    unreadable: `The saved ${thing} cannot be read any more (its encryption key changed). Enter it again.`,
    none: `No ${thing} yet.`,
  }[status.source];
}

const GROUPS = ['Global', 'China', 'Gateway', 'Local', 'More providers'] as const;

const tokens = (n: number) => (n >= 1_000_000 ? `${Number((n / 1_000_000).toFixed(1))}M` : `${Math.round(n / 1000)}k`);

// "128k context · $0.30 / $1.20 per 1M" (input / output per million tokens), as far as the catalog knows.
function modelDetail(model: CatalogModel) {
  const parts = [model.context && `${tokens(model.context)} context`, model.input === 0 && model.output === 0 ? 'free' : model.input !== undefined && model.output !== undefined && `$${model.input} / $${model.output} per 1M`];
  return parts.filter(Boolean).join(' · ') || undefined;
}

function CheckResult({ check }: { check: Check }) {
  return check && <span className={`text-sm ${check.ok ? 'text-pp-success' : 'text-pp-danger'}`}>{check.message}</span>;
}

// The shop owner's settings: business, refund limits, AI provider, PayPal and the held-refund
// channels (webhook, email, Telegram). Keys and the webhook URL are write-only: the page only ever receives their last 4 characters.
export function SettingsEditor({ view, providers, initialModels }: { view: SettingsView; providers: CatalogProvider[]; initialModels: CatalogModel[] }) {
  const formRef = useRef<HTMLFormElement>(null);
  const [state, save, saving] = useActionState(saveSettingsAction, null);
  const [provider, setProvider] = useState(view.form.provider);
  const [baseUrl, setBaseUrl] = useState(view.form.baseUrl);
  const [currency, setCurrency] = useState(view.form.currency);
  const [agentModel, setAgentModel] = useState(view.form.agentModel);
  const [judgeModel, setJudgeModel] = useState(view.form.judgeModel);
  const [catalogModels, setCatalogModels] = useState(initialModels);
  // Only the provider picked last may fill the model lists (./picker-logic).
  const [loadModels] = useState(() => latestOnly<CatalogModel[]>());
  // Models the provider itself listed on "Test connection", for providers the catalog doesn't cover.
  const [liveModels, setLiveModels] = useState<string[]>([]);
  const [aiCheck, setAiCheck] = useState<Check>(null);
  const [payPalCheck, setPayPalCheck] = useState<Check>(null);
  const [testing, startTesting] = useTransition();
  const errors: Partial<Record<keyof SettingsForm | 'form', string>> = state && !state.ok ? state.errors : {};
  const defaults = view.form;

  function chooseProvider(id: string) {
    setProvider(id);
    const preset = providers.find((p) => p.id === id);
    if (preset) setBaseUrl(preset.baseUrl);
    setLiveModels([]);
    setCatalogModels([]);
    setAiCheck(null);
    loadModels(
      () => catalogModelsAction(id),
      (models) => {
        setCatalogModels(models);
        // Start from the provider's newest model, so a provider switch never keeps another's model id.
        setAgentModel(models[0]?.id ?? '');
        setJudgeModel('');
      },
      // Without an answer the owner can still type a model id.
      [],
    );
  }

  const providerOptions: PickerOption[] = [
    ...GROUPS.flatMap((group) =>
      providers
        .filter((p) => p.group === group)
        .map((p) => ({ value: p.id, label: p.label, group, icon: p.logo, detail: p.modelCount ? `${p.modelCount} models` : undefined })),
    ),
    { value: 'custom', label: 'Custom (any OpenAI-compatible URL)', group: 'Other' },
  ];
  const modelOptions: PickerOption[] = [
    ...catalogModels.map((m) => ({ value: m.id, label: m.name, detail: modelDetail(m) })),
    ...liveModels.filter((id) => !catalogModels.some((m) => m.id === id)).map((id) => ({ value: id, label: id, group: 'Listed by the provider' })),
  ];

  function testAi() {
    startTesting(async () => {
      const result = await testAiAction(new FormData(formRef.current!));
      setLiveModels(result.ok ? result.models : []);
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
              <textarea name="refundPolicy" defaultValue={defaults.refundPolicy} rows={4} className={`${input} h-auto`} />
            </Field>
          </Section>

          <Section title="Limits" detail="Enforced by the guard whatever the AI decides: no prompt can raise them.">
            <Field label="Currency" error={errors.currency}>
              <Picker
                name="currency"
                value={currency}
                onChange={setCurrency}
                options={CURRENCIES.map((c) => ({ value: c.code, label: `${c.code} · ${c.name}`, detail: c.decimals === 0 ? 'no decimals' : undefined }))}
                disabled={view.locked}
              />
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
            <Field label="Provider" hint={`${providers.length} providers from the models.dev catalog, plus any OpenAI-compatible URL.`}>
              <Picker name="provider" value={provider} onChange={chooseProvider} options={providerOptions} disabled={view.locked} />
            </Field>
            <Field label="Base URL" error={errors.baseUrl}>
              <input name="baseUrl" value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} readOnly={provider !== 'custom'} className={input} />
            </Field>
            <Field label="API key" error={errors.apiKey} hint={keyHint(view.ai.apiKey, 'LLM_API_KEY')} wide>
              <input name="apiKey" type="password" autoComplete="off" disabled={!view.canStoreKeys} placeholder={view.ai.apiKey.hint || 'Paste your API key'} className={input} />
            </Field>
            {view.ai.apiKey.source === 'saved' && (
              <label className="flex items-center gap-2 text-sm sm:col-span-2">
                <input type="checkbox" name="clearApiKey" /> Remove the saved key
              </label>
            )}
            <Field label="Agent model" error={errors.agentModel} hint="Answers the tickets and calls PayPal tools. Only models that can call tools are listed.">
              <Picker
                name="agentModel"
                value={agentModel}
                onChange={setAgentModel}
                options={[{ value: '', label: catalogModels[0] ? `Provider default (${catalogModels[0].name})` : 'Provider default' }, ...modelOptions]}
                allowCustom
                disabled={view.locked}
              />
            </Field>
            <Field label="Judge model" error={errors.judgeModel} hint="Checks each refund against the policy.">
              <Picker
                name="judgeModel"
                value={judgeModel}
                onChange={setJudgeModel}
                options={[{ value: '', label: 'Same as the agent' }, ...modelOptions]}
                allowCustom
                disabled={view.locked}
              />
            </Field>
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
            <Field label="Secret" error={errors.paypalSecret} hint={keyHint(view.paypal.secret, 'PAYPAL_SECRET')}>
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

          <Section title="Notifications" detail="When the guard holds a refund for a person, it tells every channel set here: a Slack or Discord webhook, an email, a Telegram chat. The message names the amount, the masked customer email and the rules, never the ticket's text.">
            <Field label="Webhook URL" error={errors.webhookUrl} hint={keyHint(view.notifications.webhookUrl, 'GUARD_WEBHOOK_URL', 'URL')} wide>
              <input
                name="webhookUrl"
                type="password"
                autoComplete="off"
                disabled={!view.canStoreKeys}
                placeholder={view.notifications.webhookUrl.hint || 'https://hooks.slack.com/services/…'}
                className={input}
              />
            </Field>
            {view.notifications.webhookUrl.source === 'saved' && (
              <label className="flex items-center gap-2 text-sm sm:col-span-2">
                <input type="checkbox" name="clearWebhookUrl" /> Remove the saved webhook
              </label>
            )}
            <p className="text-sm text-pp-muted sm:col-span-2">Email is sent through Resend to the contact emails above.</p>
            <Field label="Resend API key" error={errors.resendApiKey} hint={keyHint(view.notifications.resendApiKey, 'RESEND_API_KEY')}>
              <input name="resendApiKey" type="password" autoComplete="off" disabled={!view.canStoreKeys} placeholder={view.notifications.resendApiKey.hint || 're_…'} className={input} />
            </Field>
            <Field
              label="From address"
              error={errors.emailFrom}
              hint="A sender on a domain verified in Resend. Its test sender, onboarding@resend.dev, only delivers to your own Resend account address."
            >
              <input name="emailFrom" type="email" defaultValue={defaults.emailFrom} autoComplete="off" placeholder="guard@your-domain.com" className={input} />
            </Field>
            {view.notifications.resendApiKey.source === 'saved' && (
              <label className="flex items-center gap-2 text-sm sm:col-span-2">
                <input type="checkbox" name="clearResendApiKey" /> Remove the saved Resend key
              </label>
            )}
            <Field label="Telegram bot token" error={errors.telegramBotToken} hint={keyHint(view.notifications.telegramBotToken, 'TELEGRAM_BOT_TOKEN', 'token')}>
              <input
                name="telegramBotToken"
                type="password"
                autoComplete="off"
                disabled={!view.canStoreKeys}
                placeholder={view.notifications.telegramBotToken.hint || '123456789:AA…'}
                className={input}
              />
            </Field>
            <Field label="Telegram chat id" error={errors.telegramChatId} hint="Message your bot, then open api.telegram.org/bot<token>/getUpdates and copy chat.id, or use @channelname.">
              <input name="telegramChatId" defaultValue={defaults.telegramChatId} autoComplete="off" placeholder="-1001234567890" className={input} />
            </Field>
            {view.notifications.telegramBotToken.source === 'saved' && (
              <label className="flex items-center gap-2 text-sm sm:col-span-2">
                <input type="checkbox" name="clearTelegramBotToken" /> Remove the saved bot token
              </label>
            )}
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
