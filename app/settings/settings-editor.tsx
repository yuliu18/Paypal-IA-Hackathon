'use client';

import { startTransition, useActionState, useEffect, useRef, useState, useTransition } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import type { KeyStatus, SettingsForm, SettingsView } from '@/lib/settings/settings';
import type { CatalogModel, CatalogProvider } from '@/lib/settings/catalog';
import { CURRENCIES } from '@/lib/settings/currencies';
import { catalogModelsAction, saveSettingsAction, testAiAction, testPayPalAction } from './actions';
import { Picker, type PickerOption } from './picker';
import { latestOnly } from './picker-logic';
import { firstSectionWithError, sectionFrom, type SettingsSectionId } from './sections';
import { PageHeader } from '../ui/page-header';
import { primaryButton, Spinner } from '../ui/desk';
import { LanguagePicker } from './language-picker';
import { ApiKeysSection, type ApiKeysView } from './api-keys-section';

type Check = { ok: boolean; message: string } | null;
// The page's text, from messages/<locale>/settings.json.
type T = ReturnType<typeof useTranslations<'settings'>>;

// Every one-line field is h-10, so inputs and pickers line up.
const input =
  'h-10 w-full rounded-md border border-pp-border bg-pp-surface px-3 py-2 text-sm text-pp-ink focus:border-pp-blue focus:outline-none disabled:bg-pp-canvas disabled:text-pp-muted';
const button =
  'rounded-md border border-pp-border bg-pp-surface px-3 py-1.5 text-sm font-semibold text-pp-ink hover:border-pp-blue disabled:opacity-60';

// One section of the form. Only the open one shows; the others stay in the form, hidden, so one
// save keeps every field.
// `cards`: the section is a stack of cards of its own (one per notification channel) rather than one card.
function Section({ id, open, title, detail, cards, children }: { id: SettingsSectionId; open: SettingsSectionId; title: string; detail: string; cards?: boolean; children: React.ReactNode }) {
  return (
    <section id={`settings-${id}`} hidden={id !== open} className={cards ? '' : 'rounded-lg border border-pp-border bg-pp-surface p-6'}>
      <h2 className="text-lg font-semibold">{title}</h2>
      <p className="mt-1 max-w-2xl text-sm leading-relaxed text-pp-muted">{detail}</p>
      {cards ? <div className="mt-5 space-y-4">{children}</div> : <div className="mt-5 grid gap-4 sm:grid-cols-2">{children}</div>}
    </section>
  );
}

// One notification channel: its own card, saying whether it is set up.
function Channel({ title, detail, on, children }: { title: string; detail: string; on: boolean; children: React.ReactNode }) {
  const common = useTranslations('common');
  return (
    <div className="rounded-lg border border-pp-border bg-pp-surface p-6">
      <div className="flex items-center justify-between gap-4">
        <h3 className="font-semibold">{title}</h3>
        <span
          className={`rounded-[3px] border px-2 py-0.5 text-xs font-semibold ${on ? 'border-pp-success/40 bg-pp-success-tint text-pp-success' : 'border-pp-border bg-pp-canvas text-pp-muted'}`}
        >
          {on ? common('on') : common('off')}
        </span>
      </div>
      <p className="mt-1 max-w-2xl text-sm leading-relaxed text-pp-muted">{detail}</p>
      <div className="mt-5 grid gap-4 sm:grid-cols-2">{children}</div>
    </div>
  );
}

const isSet = (status: KeyStatus) => status.source === 'saved' || status.source === 'env';

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
function keyHint(t: T, status: KeyStatus, variable: string, thing: 'key' | 'url' | 'password' | 'token' = 'key') {
  return t(`keyHint.${status.source}`, { thing, variable, hint: status.hint });
}

// Inline markup the setup guides' messages may use: <strong>, <em>, <code> and one <link>.
const markup = {
  strong: (chunks: React.ReactNode) => <strong>{chunks}</strong>,
  em: (chunks: React.ReactNode) => <em>{chunks}</em>,
  code: (chunks: React.ReactNode) => <code>{chunks}</code>,
};
const linkTo = (href: string) => ({ ...markup, link: (chunks: React.ReactNode) => <ExternalLink href={href}>{chunks}</ExternalLink> });

const GROUPS = ['Global', 'China', 'Gateway', 'Local', 'More providers'] as const;

const tokens = (n: number) => (n >= 1_000_000 ? `${Number((n / 1_000_000).toFixed(1))}M` : `${Math.round(n / 1000)}k`);

// "128k context · $0.30 / $1.20 per 1M" (input / output per million tokens), as far as the catalog knows.
function modelDetail(t: T, model: CatalogModel) {
  const parts = [
    model.context && t('model.context', { size: tokens(model.context) }),
    model.input === 0 && model.output === 0 ? t('model.free') : model.input !== undefined && model.output !== undefined && t('model.price', { input: model.input, output: model.output }),
  ];
  return parts.filter(Boolean).join(' · ') || undefined;
}

function CheckResult({ check }: { check: Check }) {
  return check && <span className={`text-sm ${check.ok ? 'text-pp-success' : 'text-pp-danger'}`}>{check.message}</span>;
}

// The shop owner's settings: business, refund limits, AI provider, PayPal and the held-refund
// channels (webhook, email, Telegram). Keys and the webhook URL are write-only: the page only ever receives their last 4 characters.
export function SettingsEditor({
  view,
  providers,
  initialModels,
  apiKeys,
}: {
  view: SettingsView;
  providers: CatalogProvider[];
  initialModels: CatalogModel[];
  apiKeys: ApiKeysView;
}) {
  const t = useTranslations('settings');
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
  // The open section is in the address (/settings?section=limits), so the side menu's list of
  // sections (./settings-nav.tsx) and the page agree on it.
  const router = useRouter();
  const open = sectionFrom(useSearchParams().get('section'));
  // A rejected save opens the first section with a field it names.
  useEffect(() => {
    if (!state || state.ok) return;
    const withError = firstSectionWithError(state.errors);
    if (withError) router.replace(`/settings?section=${withError}`, { scroll: false });
  }, [state, router]);

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
        .map((p) => ({ value: p.id, label: p.label, group: t(`groups.${group}`), icon: p.logo, detail: p.modelCount ? t('model.count', { count: p.modelCount }) : undefined })),
    ),
    { value: 'custom', label: t('ai.custom'), group: t('groups.Other') },
  ];
  const modelOptions: PickerOption[] = [
    ...catalogModels.map((m) => ({ value: m.id, label: m.name, detail: modelDetail(t, m) })),
    ...liveModels.filter((id) => !catalogModels.some((m) => m.id === id)).map((id) => ({ value: id, label: id, group: t('groups.listed') })),
  ];

  function testAi() {
    startTesting(async () => {
      const result = await testAiAction(new FormData(formRef.current!));
      setLiveModels(result.ok ? result.models : []);
      if (!result.ok) return setAiCheck({ ok: false, message: result.error });
      setAiCheck({ ok: true, message: result.models.length ? t('ai.connectedModels', { count: result.models.length }) : t('ai.connectedAgent') });
    });
  }

  function testPayPalConnection() {
    startTesting(async () => {
      const result = await testPayPalAction(new FormData(formRef.current!));
      setPayPalCheck(result.ok ? { ok: true, message: t('paypal.connected') } : { ok: false, message: result.error });
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
      <PageHeader title={t('title')}>{t('intro')}</PageHeader>
      {view.locked && (
        <p className="mt-6 rounded-lg border border-pp-warning/40 bg-pp-warning-tint px-4 py-3 text-sm text-pp-warning">
          {t('locked')}
        </p>
      )}

      <form ref={formRef} onSubmit={submit} className="mt-8 max-w-4xl">
        <div className="min-w-0 space-y-6">
        <Section id="language" open={open} title={t('language.title')} detail={t('language.detail')}>
          <LanguagePicker />
        </Section>
        <fieldset disabled={view.locked} className="min-w-0 space-y-6">
          <Section id="business" open={open} title={t('sections.business')} detail={t('business.detail')}>
            <Field label={t('business.name')} error={errors.name}>
              <input name="name" defaultValue={defaults.name} className={input} />
            </Field>
            <Field label={t('business.contactEmails')} error={errors.contactEmails} hint={t('business.contactEmailsHint')}>
              <input name="contactEmails" defaultValue={defaults.contactEmails} placeholder="help@yourshop.com" className={input} />
            </Field>
            <Field label={t('business.refundPolicy')} error={errors.refundPolicy} wide>
              <textarea name="refundPolicy" defaultValue={defaults.refundPolicy} rows={8} className={`${input} h-auto leading-relaxed`} />
            </Field>
          </Section>

          <Section id="limits" open={open} title={t('sections.limits')} detail={t('limits.detail')}>
            <Field label={t('limits.currency')} error={errors.currency}>
              <Picker
                name="currency"
                value={currency}
                onChange={setCurrency}
                options={CURRENCIES.map((c) => ({ value: c.code, label: `${c.code} · ${c.name}`, detail: c.decimals === 0 ? t('limits.noDecimals') : undefined }))}
                disabled={view.locked}
              />
            </Field>
            <Field label={t('limits.autoRefundUpTo')} error={errors.autoRefundUpTo} hint={t('limits.autoRefundUpToHint')}>
              <input name="autoRefundUpTo" defaultValue={defaults.autoRefundUpTo} inputMode="decimal" className={input} />
            </Field>
            <Field label={t('limits.approvalUpTo')} error={errors.approvalUpTo} hint={t('limits.approvalUpToHint')}>
              <input name="approvalUpTo" defaultValue={defaults.approvalUpTo} inputMode="decimal" className={input} />
            </Field>
            <Field label={t('limits.dailyCap')} error={errors.dailyCap} hint={t('limits.dailyCapHint')}>
              <input name="dailyCap" defaultValue={defaults.dailyCap} inputMode="decimal" className={input} />
            </Field>
          </Section>

          <Section id="ai" open={open} title={t('sections.ai')} detail={t('ai.detail')}>
            <Field label={t('ai.provider')} hint={t('ai.providerHint', { count: providers.length })}>
              <Picker name="provider" value={provider} onChange={chooseProvider} options={providerOptions} disabled={view.locked} />
            </Field>
            <Field label={t('ai.baseUrl')} error={errors.baseUrl}>
              <input name="baseUrl" value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} readOnly={provider !== 'custom'} className={input} />
            </Field>
            <Field label={t('ai.apiKey')} error={errors.apiKey} hint={keyHint(t, view.ai.apiKey, 'LLM_API_KEY')} wide>
              <input name="apiKey" type="password" autoComplete="off" disabled={!view.canStoreKeys} placeholder={view.ai.apiKey.hint || t('ai.apiKeyPlaceholder')} className={input} />
            </Field>
            {view.ai.apiKey.source === 'saved' && (
              <label className="flex items-center gap-2 text-sm sm:col-span-2">
                <input type="checkbox" name="clearApiKey" /> {t('ai.removeKey')}
              </label>
            )}
            <Field label={t('ai.agentModel')} error={errors.agentModel} hint={t('ai.agentModelHint')}>
              <Picker
                name="agentModel"
                value={agentModel}
                onChange={setAgentModel}
                options={[{ value: '', label: catalogModels[0] ? t('ai.providerDefaultNamed', { name: catalogModels[0].name }) : t('ai.providerDefault') }, ...modelOptions]}
                allowCustom
                disabled={view.locked}
              />
            </Field>
            <Field label={t('ai.judgeModel')} error={errors.judgeModel} hint={t('ai.judgeModelHint')}>
              <Picker
                name="judgeModel"
                value={judgeModel}
                onChange={setJudgeModel}
                options={[{ value: '', label: t('ai.sameAsAgent') }, ...modelOptions]}
                allowCustom
                disabled={view.locked}
              />
            </Field>
            <div className="flex items-center gap-3 sm:col-span-2">
              <button type="button" onClick={testAi} disabled={testing} className={button}>
                {t('testConnection')}
              </button>
              <CheckResult check={aiCheck} />
            </div>
          </Section>

          <Section id="paypal" open={open} title={t('sections.paypal')} detail={t('paypal.detail')}>
            <Field label={t('paypal.clientId')} error={errors.paypalClientId}>
              <input name="paypalClientId" defaultValue={defaults.paypalClientId} autoComplete="off" className={input} />
            </Field>
            <Field label={t('paypal.secret')} error={errors.paypalSecret} hint={keyHint(t, view.paypal.secret, 'PAYPAL_SECRET')}>
              <input name="paypalSecret" type="password" autoComplete="off" disabled={!view.canStoreKeys} placeholder={view.paypal.secret.hint} className={input} />
            </Field>
            {view.paypal.secret.source === 'saved' && (
              <label className="flex items-center gap-2 text-sm sm:col-span-2">
                <input type="checkbox" name="clearPaypalSecret" /> {t('paypal.removeSecret')}
              </label>
            )}
            <div className="flex items-center gap-3 sm:col-span-2">
              <button type="button" onClick={testPayPalConnection} disabled={testing} className={button}>
                {t('testConnection')}
              </button>
              <CheckResult check={payPalCheck} />
            </div>
          </Section>

          <Section
            id="notifications"
            open={open}
            cards
            title={t('sections.notifications')}
            detail={t('notifications.detail')}
          >
            <Channel title={t('notifications.webhook.title')} detail={t('notifications.webhook.detail')} on={isSet(view.notifications.webhookUrl)}>
              <Field label={t('notifications.webhook.url')} error={errors.webhookUrl} hint={keyHint(t, view.notifications.webhookUrl, 'GUARD_WEBHOOK_URL', 'url')} wide>
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
                  <input type="checkbox" name="clearWebhookUrl" /> {t('notifications.webhook.remove')}
                </label>
              )}
              <SetupGuide title={t('notifications.webhook.guide')}>
                <li>{t.rich('notifications.webhook.step1', linkTo('https://api.slack.com/apps'))}</li>
                <li>{t.rich('notifications.webhook.step2', markup)}</li>
                <li>{t('notifications.webhook.step3')}</li>
              </SetupGuide>
            </Channel>
            <Channel
              title={t('notifications.email.title')}
              detail={t('notifications.email.detail')}
              on={Boolean(defaults.smtpHost && isSet(view.notifications.smtpPassword)) || isSet(view.notifications.resendApiKey)}
            >
              <Field
                label={t('notifications.email.from')}
                error={errors.emailFrom}
                hint={t('notifications.email.fromHint')}
                wide
              >
                <input name="emailFrom" type="email" defaultValue={defaults.emailFrom} autoComplete="off" placeholder="guard@your-domain.com" className={input} />
              </Field>
              <Field label={t('notifications.email.smtpHost')} error={errors.smtpHost}>
                <input name="smtpHost" defaultValue={defaults.smtpHost} autoComplete="off" placeholder="smtp.gmail.com" className={input} />
              </Field>
              <Field label={t('notifications.email.smtpPort')} error={errors.smtpPort} hint={t('notifications.email.smtpPortHint')}>
                <input name="smtpPort" inputMode="numeric" defaultValue={defaults.smtpPort} autoComplete="off" placeholder="587" className={input} />
              </Field>
              <Field label={t('notifications.email.smtpUser')} error={errors.smtpUser}>
                <input name="smtpUser" defaultValue={defaults.smtpUser} autoComplete="off" placeholder="you@gmail.com" className={input} />
              </Field>
              <Field
                label={t('notifications.email.smtpPassword')}
                error={errors.smtpPassword}
                hint={`${keyHint(t, view.notifications.smtpPassword, 'SMTP_PASSWORD', 'password')} ${t('notifications.email.smtpPasswordForgets')}`}
              >
                <input
                  name="smtpPassword"
                  type="password"
                  autoComplete="off"
                  disabled={!view.canStoreKeys}
                  placeholder={view.notifications.smtpPassword.hint || t('notifications.email.smtpPasswordPlaceholder')}
                  className={input}
                />
              </Field>
              {view.notifications.smtpPassword.source === 'saved' && (
                <label className="flex items-center gap-2 text-sm sm:col-span-2">
                  <input type="checkbox" name="clearSmtpPassword" /> {t('notifications.email.removeSmtpPassword')}
                </label>
              )}
              <SetupGuide title={t('notifications.email.smtpGuide')}>
                <li>{t.rich('notifications.email.smtpStep1', linkTo('https://myaccount.google.com/apppasswords'))}</li>
                <li>{t.rich('notifications.email.smtpStep2', markup)}</li>
                <li>{t.rich('notifications.email.smtpStep3', markup)}</li>
                <li>{t('notifications.email.smtpStep4')}</li>
                <li>{t('notifications.email.smtpStep5')}</li>
              </SetupGuide>
              <Field label={t('notifications.email.resendKey')} error={errors.resendApiKey} hint={keyHint(t, view.notifications.resendApiKey, 'RESEND_API_KEY')}>
                <input name="resendApiKey" type="password" autoComplete="off" disabled={!view.canStoreKeys} placeholder={view.notifications.resendApiKey.hint || 're_…'} className={input} />
              </Field>
              {view.notifications.resendApiKey.source === 'saved' && (
                <label className="flex items-center gap-2 text-sm sm:col-span-2">
                  <input type="checkbox" name="clearResendApiKey" /> {t('notifications.email.removeResendKey')}
                </label>
              )}
              <SetupGuide title={t('notifications.email.resendGuide')}>
                <li>{t.rich('notifications.email.resendStep1', linkTo('https://resend.com'))}</li>
                <li>{t.rich('notifications.email.resendStep2', markup)}</li>
                <li>{t.rich('notifications.email.resendStep3', markup)}</li>
                <li>{t('notifications.email.resendStep4')}</li>
              </SetupGuide>
            </Channel>
            <Channel title={t('notifications.telegram.title')} detail={t('notifications.telegram.detail')} on={isSet(view.notifications.telegramBotToken) && Boolean(defaults.telegramChatId)}>
              <Field label={t('notifications.telegram.token')} error={errors.telegramBotToken} hint={keyHint(t, view.notifications.telegramBotToken, 'TELEGRAM_BOT_TOKEN', 'token')}>
                <input
                  name="telegramBotToken"
                  type="password"
                  autoComplete="off"
                  disabled={!view.canStoreKeys}
                  placeholder={view.notifications.telegramBotToken.hint || '123456789:AA…'}
                  className={input}
                />
              </Field>
              <Field label={t('notifications.telegram.chatId')} error={errors.telegramChatId} hint={t('notifications.telegram.chatIdHint', { token: '<token>' })}>
                <input name="telegramChatId" defaultValue={defaults.telegramChatId} autoComplete="off" placeholder="-1001234567890" className={input} />
              </Field>
              {view.notifications.telegramBotToken.source === 'saved' && (
                <label className="flex items-center gap-2 text-sm sm:col-span-2">
                  <input type="checkbox" name="clearTelegramBotToken" /> {t('notifications.telegram.removeToken')}
                </label>
              )}
              <SetupGuide title={t('notifications.telegram.guide')}>
                <li>{t.rich('notifications.telegram.step1', linkTo('https://t.me/BotFather'))}</li>
                <li>{t.rich('notifications.telegram.step2', markup)}</li>
                <li>
                  {t.rich('notifications.telegram.step3', {
                    ...markup,
                    url: 'https://api.telegram.org/bot<token>/getUpdates',
                    brackets: '< >',
                    chat: '"chat": { "id": … }',
                  })}
                </li>
                <li>{t.rich('notifications.telegram.step4', { ...markup, empty: '"result": []' })}</li>
                <li>{t.rich('notifications.telegram.step5', markup)}</li>
              </SetupGuide>
            </Channel>
          </Section>

          {/* The language and the API keys save on their own, so the form's button stays out of their sections. */}
          <div hidden={open === 'language' || open === 'api-keys'} className="flex flex-wrap items-center gap-4">
            <button type="submit" disabled={saving} className={primaryButton}>
              {saving && <Spinner />}
              {saving ? t('save.saving') : t('save.button')}
            </button>
            <span className="text-sm text-pp-muted">{t('save.scope')}</span>
            {state?.ok && <span className="text-sm text-pp-success">{t('save.saved')}</span>}
            {errors.form && <span className="text-sm text-pp-danger">{errors.form}</span>}
            {state && !state.ok && !errors.form && <span className="text-sm text-pp-danger">{t('save.checkFields')}</span>}
          </div>
        </fieldset>
        </div>
      </form>
      {/* Outside the settings form: a form can't hold another. */}
      <div className="max-w-4xl">
        <ApiKeysSection hidden={open !== 'api-keys'} view={apiKeys} locked={view.locked} />
      </div>
    </main>
  );
}
