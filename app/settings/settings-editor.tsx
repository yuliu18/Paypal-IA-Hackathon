'use client';

import { startTransition, useActionState, useRef, useState, useTransition } from 'react';
import type { KeyStatus, SettingsForm, SettingsView } from '@/lib/settings/settings';
import type { CatalogModel, CatalogProvider } from '@/lib/settings/catalog';
import { CURRENCIES } from '@/lib/settings/currencies';
import { catalogModelsAction, saveSettingsAction, testAiAction, testPayPalAction } from './actions';
import { Picker, type PickerOption } from './picker';
import { latestOnly } from './picker-logic';
import { firstSectionWithError, sectionHasError, SETTINGS_SECTIONS, type SettingsSectionId } from './sections';
import { PageHeader } from '../ui/page-header';
import { primaryButton, Spinner } from '../ui/desk';

type Check = { ok: boolean; message: string } | null;

// Every one-line field is h-10, so inputs and pickers line up.
const input =
  'h-10 w-full rounded-md border border-pp-border bg-pp-surface px-3 py-2 text-sm text-pp-ink focus:border-pp-blue focus:outline-none disabled:bg-pp-canvas disabled:text-pp-muted';
const button =
  'rounded-md border border-pp-border bg-pp-surface px-3 py-1.5 text-sm font-semibold text-pp-ink hover:border-pp-blue disabled:opacity-60';

// One section of the form. Only the open one shows; the others stay in the form, hidden, so one
// save keeps every field.
function Section({ id, open, title, detail, children }: { id: SettingsSectionId; open: SettingsSectionId; title: string; detail: string; children: React.ReactNode }) {
  return (
    <section id={`settings-${id}`} role="tabpanel" aria-labelledby={`tab-${id}`} hidden={id !== open} className="rounded-lg border border-pp-border bg-pp-surface p-6">
      <h2 className="text-lg font-semibold">{title}</h2>
      <p className="mt-1 max-w-2xl text-sm leading-relaxed text-pp-muted">{detail}</p>
      <div className="mt-5 grid gap-4 sm:grid-cols-2">{children}</div>
    </section>
  );
}

function Field({ label, error, hint, wide, children }: { label: string; error?: string; hint?: React.ReactNode; wide?: boolean; children: React.ReactNode }) {
  return (
    <label className={`block min-w-0 text-sm ${wide ? 'sm:col-span-2' : ''}`}>
      <span className="mb-1 block font-semibold text-pp-ink">{label}</span>
      {children}
      {hint && !error && <span className="mt-1 block text-xs text-pp-muted wrap-anywhere">{hint}</span>}
      {error && <span className="mt-1 block text-xs text-pp-danger">{error}</span>}
    </label>
  );
}

const link = 'font-semibold text-pp-blue underline';

// Step-by-step setup for one notification channel, folded behind a button-like summary.
function SetupGuide({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <details className="min-w-0 text-sm sm:col-span-2">
      <summary className={`${button} inline-block cursor-pointer select-none`}>{title}</summary>
      <ol className="mt-3 list-decimal space-y-1.5 rounded border border-pp-border bg-pp-canvas p-4 pl-8 text-pp-ink wrap-anywhere">{children}</ol>
    </details>
  );
}

function ExternalLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" className={link}>
      {children}
    </a>
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
  const [open, setOpen] = useState<SettingsSectionId>('business');
  // A rejected save opens the first section with a field it names (set during render, when a new
  // answer arrives, rather than in an effect).
  const [answered, setAnswered] = useState(state);
  if (state !== answered) {
    setAnswered(state);
    const withError = firstSectionWithError(errors);
    if (withError) setOpen(withError);
  }

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
    <main className="mx-auto w-full max-w-6xl px-6 py-8 font-paypal text-pp-ink md:px-10">
      <PageHeader title="Settings">Adapt the agents and their payment guard to your business. Changes apply to the next conversation.</PageHeader>
      {view.locked && (
        <p className="mt-6 rounded-lg border border-pp-warning/40 bg-pp-warning-tint px-4 py-3 text-sm text-pp-warning">
          Read-only: this server sets SETTINGS_LOCKED, so the public demo&apos;s keys and limits can&apos;t be changed.
        </p>
      )}

      <form ref={formRef} onSubmit={submit} className="mt-8 grid items-start gap-8 md:grid-cols-[12rem_minmax(0,1fr)]">
        <nav role="tablist" aria-label="Settings sections" aria-orientation="vertical" className="flex gap-1 overflow-x-auto md:sticky md:top-8 md:flex-col">
          {SETTINGS_SECTIONS.map((section) => {
            const current = section.id === open;
            return (
              <button
                key={section.id}
                id={`tab-${section.id}`}
                type="button"
                role="tab"
                aria-selected={current}
                aria-controls={`settings-${section.id}`}
                onClick={() => setOpen(section.id)}
                className={`flex shrink-0 items-center justify-between gap-3 rounded-md px-3 py-2 text-left text-sm ${current ? 'bg-pp-highlight font-semibold text-pp-blue' : 'text-pp-ink hover:bg-pp-surface'}`}
              >
                {section.label}
                {sectionHasError(errors, section.id) && <span className="size-2 rounded-full bg-pp-danger" aria-label="has an error" />}
              </button>
            );
          })}
        </nav>
        <fieldset disabled={view.locked} className="min-w-0 space-y-6">
          <Section id="business" open={open} title="Business" detail="Who the agents work for and the refund policy they follow. The guard's AI judge checks every refund against this policy.">
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

          <Section id="limits" open={open} title="Limits" detail="Enforced by the guard whatever the AI decides: no prompt can raise them.">
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

          <Section id="ai" open={open} title="AI model" detail="The model that runs the agents and the one that judges their calls. Any provider with an OpenAI-compatible API works: cloud, Chinese or running on your own machine.">
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

          <Section id="paypal" open={open} title="PayPal app" detail="The agents reach PayPal through a REST app you create in the PayPal Developer Dashboard (developer.paypal.com, Apps & Credentials). Paste its sandbox client ID and secret here. Money in the sandbox is fictitious.">
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

          <Section id="notifications" open={open} title="Notifications" detail="When the guard holds a refund for a person, it tells every channel set here: a Slack or Discord webhook, an email, a Telegram chat. The message names the amount, the masked customer email and the rules, never the ticket's text.">
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
            <SetupGuide title="How to get a Slack or Discord webhook">
              <li>
                <strong>Slack:</strong> on <ExternalLink href="https://api.slack.com/apps">api.slack.com/apps</ExternalLink>, create an app from scratch in your workspace, open{' '}
                <em>Incoming Webhooks</em>, turn them on, click <em>Add New Webhook to Workspace</em>, pick the channel and copy the URL.
              </li>
              <li>
                <strong>Discord:</strong> in your server, open the channel&apos;s <em>Edit Channel</em> → <em>Integrations</em> → <em>Webhooks</em> → <em>New Webhook</em>, then{' '}
                <em>Copy Webhook URL</em>.
              </li>
              <li>Paste the URL above and save. The URL works as a password: anyone who has it can post to the channel.</li>
            </SetupGuide>
            <p className="text-sm text-pp-muted sm:col-span-2">
              Email goes to the contact emails above, through your own mail server (SMTP) when its server, login and password are set, otherwise through Resend.
            </p>
            <Field
              label="From address"
              error={errors.emailFrom}
              hint="With SMTP, leave blank to send from the login. With Resend, a sender on a domain verified there, or onboarding@resend.dev to try it."
              wide
            >
              <input name="emailFrom" type="email" defaultValue={defaults.emailFrom} autoComplete="off" placeholder="guard@your-domain.com" className={input} />
            </Field>
            <Field label="SMTP server" error={errors.smtpHost}>
              <input name="smtpHost" defaultValue={defaults.smtpHost} autoComplete="off" placeholder="smtp.gmail.com" className={input} />
            </Field>
            <Field label="SMTP port" error={errors.smtpPort} hint="587 (STARTTLS) or 465 (TLS). Blank means 587.">
              <input name="smtpPort" inputMode="numeric" defaultValue={defaults.smtpPort} autoComplete="off" placeholder="587" className={input} />
            </Field>
            <Field label="SMTP login" error={errors.smtpUser}>
              <input name="smtpUser" defaultValue={defaults.smtpUser} autoComplete="off" placeholder="you@gmail.com" className={input} />
            </Field>
            <Field
              label="SMTP password"
              error={errors.smtpPassword}
              hint={`${keyHint(view.notifications.smtpPassword, 'SMTP_PASSWORD', 'password')} Changing the server or login forgets it.`}
            >
              <input
                name="smtpPassword"
                type="password"
                autoComplete="off"
                disabled={!view.canStoreKeys}
                placeholder={view.notifications.smtpPassword.hint || 'App password'}
                className={input}
              />
            </Field>
            {view.notifications.smtpPassword.source === 'saved' && (
              <label className="flex items-center gap-2 text-sm sm:col-span-2">
                <input type="checkbox" name="clearSmtpPassword" /> Remove the saved SMTP password
              </label>
            )}
            <SetupGuide title="How to set up email with your own mail (SMTP)">
              <li>
                <strong>Gmail:</strong> turn on 2-Step Verification for the account, then create an app password on{' '}
                <ExternalLink href="https://myaccount.google.com/apppasswords">myaccount.google.com/apppasswords</ExternalLink>. Use server <code>smtp.gmail.com</code>,
                port <code>587</code>, your Gmail address as login and the 16-letter app password, without spaces. Your normal password does not work.
              </li>
              <li>
                <strong>Outlook or Microsoft 365:</strong> server <code>smtp.office365.com</code>, port <code>587</code>, your address and password (an app password if
                the account uses two-step sign-in). Your administrator may need to allow SMTP for the mailbox.
              </li>
              <li>
                <strong>Your hosting&apos;s mail:</strong> the server, port and login are in your hosting panel&apos;s email settings, often <code>mail.your-domain.com</code>{' '}
                with your full address as login.
              </li>
              <li>Leave the from address blank: most mail servers only send from the account you log in with.</li>
              <li>The password only travels encrypted (TLS), and is only ever sent to the server and login it was saved with.</li>
            </SetupGuide>
            <Field label="Resend API key" error={errors.resendApiKey} hint={keyHint(view.notifications.resendApiKey, 'RESEND_API_KEY')}>
              <input name="resendApiKey" type="password" autoComplete="off" disabled={!view.canStoreKeys} placeholder={view.notifications.resendApiKey.hint || 're_…'} className={input} />
            </Field>
            {view.notifications.resendApiKey.source === 'saved' && (
              <label className="flex items-center gap-2 text-sm sm:col-span-2">
                <input type="checkbox" name="clearResendApiKey" /> Remove the saved Resend key
              </label>
            )}
            <SetupGuide title="How to set up email with Resend">
              <li>
                Sign up on <ExternalLink href="https://resend.com">resend.com</ExternalLink> (the free plan is enough), open <em>API Keys</em>, create a key with sending
                access and paste it above.
              </li>
              <li>
                <strong>To try it:</strong> use <code>onboarding@resend.dev</code> as the from address and put your Resend account&apos;s email in Contact emails under
                Business. Resend&apos;s test sender only delivers to that address, and may land in spam.
              </li>
              <li>
                <strong>For real:</strong> in Resend, open <em>Domains</em>, add your domain, add the DNS records it shows, and once it is verified use an address on it,
                like <code>guard@your-domain.com</code>.
              </li>
              <li>Every contact email under Business gets the message.</li>
            </SetupGuide>
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
            <SetupGuide title="How to set up Telegram">
              <li>
                In Telegram, open <ExternalLink href="https://t.me/BotFather">@BotFather</ExternalLink>, send <code>/newbot</code>, choose a name and a username ending in{' '}
                <code>bot</code>, and paste the token it gives you (<code>123456789:AA…</code>) above.
              </li>
              <li>
                Open a chat with your new bot, press <em>Start</em> and send it any message. For a group, add the bot to the group and send a message there.
              </li>
              <li>
                In a browser, open <code>https://api.telegram.org/bot&lt;token&gt;/getUpdates</code>, with your token right after <code>bot</code> and no spaces or{' '}
                <code>&lt; &gt;</code>. Copy the number in <code>&quot;chat&quot;: {'{'} &quot;id&quot;: … {'}'}</code> into Telegram chat id. A group&apos;s id starts with{' '}
                <code>-100</code>.
              </li>
              <li>
                If it shows <code>&quot;result&quot;: []</code>, the bot has no message yet: send it one and reload.
              </li>
              <li>
                Set <code>APP_URL</code> on the server so the message links to the guard page; without it, Telegram shows <code>/guard</code> as a bot command.
              </li>
            </SetupGuide>
          </Section>

          <div className="flex flex-wrap items-center gap-4">
            <button type="submit" disabled={saving} className={primaryButton}>
              {saving && <Spinner />}
              {saving ? 'Saving…' : 'Save settings'}
            </button>
            <span className="text-sm text-pp-muted">Saves every section, not only this one.</span>
            {state?.ok && <span className="text-sm text-pp-success">Saved. The next ticket uses these settings.</span>}
            {errors.form && <span className="text-sm text-pp-danger">{errors.form}</span>}
            {state && !state.ok && !errors.form && <span className="text-sm text-pp-danger">Check the highlighted fields.</span>}
          </div>
        </fieldset>
      </form>
    </main>
  );
}
