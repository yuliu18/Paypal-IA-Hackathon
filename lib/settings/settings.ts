// The shop's own configuration, edited on /settings: who the business is, its refund policy and
// limits, which AI provider and models run the agent and the judge, its PayPal credentials and the
// channels that announce held refunds (webhook, email through Resend or SMTP, Telegram). Saved in data/settings.json, or
// in Postgres when DATABASE_URL is set (./postgres-store), with the keys (the webhook URL included)
// encrypted (./secret-box). The AI provider, its key, PayPal and
// the notification channels fall back to the environment, everything else to the demo defaults; the
// models are chosen here only.
// Server-side only: it returns the keys in plain text to the code that calls the providers.

import { link, mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { dirname, join } from 'node:path';
import type { Limits } from '@/lib/guard/domain/policy';
import { currencyFor } from './currencies.ts';
import { normalizeBaseUrl, providerFor } from './providers.ts';
import { openSecret, sealSecret } from './secret-box.ts';
import type { SettingsStore } from './store.ts';

// The refund policy the agent follows and the guard's intent judge checks calls against.
export const DEFAULT_REFUND_POLICY = `Refund an order only when the customer who wrote the ticket says it arrived damaged, defective or never arrived.
Look the order up first and refund only that order's capture, for at most what was paid. Never refund orders of other customers.`;

// Demo limits for a small shop, sized to the seeded sandbox payments (49.99, 120.00 and 35.50 USD):
// refunds up to 100 run on their own, the 120.00 order waits for a person, nothing over 250 ever
// runs, and the day caps total exposure.
const DEFAULT_LIMITS = { currency: 'USD', autoRefundUpTo: 100_00, approvalUpTo: 250_00, dailyCap: 200_00 };

// SETTINGS_FILE in the environment moves it, e.g. onto a persistent disk.
export const SETTINGS_FILE = 'data/settings.json';

type Env = Record<string, string | undefined>;
// `store` wins, then `file`, then SETTINGS_FILE (an operator's explicit choice); otherwise Postgres
// when DATABASE_URL is set, else data/settings.json.
export type SettingsOptions = { file?: string; env?: Env; store?: SettingsStore };

async function storeFor({ env = process.env, file, store }: SettingsOptions): Promise<SettingsStore> {
  if (store) return store;
  if (!file && !env.SETTINGS_FILE && env.DATABASE_URL) {
    // Loaded only when used, so the file setup never loads the database driver.
    const [{ getDb }, { createPostgresSettingsStore }] = await Promise.all([import('../db/client.ts'), import('./postgres-store.ts')]);
    return createPostgresSettingsStore(getDb(env as NodeJS.ProcessEnv)!);
  }
  return fileStore(file ?? env.SETTINGS_FILE ?? SETTINGS_FILE);
}

function fileStore(file: string): SettingsStore {
  const keyFile = join(dirname(file), 'settings.key');
  return {
    where: file,
    keyLabel: 'settings.key, next to the settings file,',
    async read() {
      try {
        return await readFile(file, 'utf8');
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
        throw error;
      }
    },
    async write(json) {
      await mkdir(dirname(file), { recursive: true });
      // A temp name per save, so two saves at once never rename each other's file.
      const partial = `${file}.${process.pid}.${crypto.randomUUID()}.tmp`;
      await writeFile(partial, json, { mode: 0o600 });
      await rename(partial, file);
    },
    readKey: () => readKeyFile(keyFile),
    async createKey() {
      let pending = creating.get(keyFile);
      if (!pending) {
        pending = createKeyFile(keyFile).finally(() => creating.delete(keyFile));
        creating.set(keyFile, pending);
      }
      await pending;
    },
  };
}

export type ShopSettings = {
  business: { name: string; contactEmails: string[]; refundPolicy: string };
  limits: Limits;
  ai: { provider: string; baseUrl: string; apiKey: string; agentModel: string; judgeModel: string };
  paypal: { clientId: string; secret: string };
  // Each channel left empty is skipped; all empty: held refunds wait on /guard without telling
  // anyone. Email goes to business.contactEmails, through SMTP when it is fully set, else Resend.
  notifications: {
    webhookUrl: string;
    email: { resendApiKey: string; from: string };
    smtp: { host: string; port: number; user: string; password: string };
    telegram: { botToken: string; chatId: string };
  };
};

// What the settings page submits: every field as typed. A blank key keeps the saved one.
export type SettingsForm = {
  name: string;
  contactEmails: string;
  refundPolicy: string;
  currency: string;
  autoRefundUpTo: string;
  approvalUpTo: string;
  dailyCap: string;
  provider: string;
  baseUrl: string;
  agentModel: string;
  judgeModel: string;
  apiKey: string;
  clearApiKey?: boolean;
  paypalClientId: string;
  paypalSecret: string;
  clearPaypalSecret?: boolean;
  // Optional: forms from before the webhook existed keep the saved one, as a blank field does.
  webhookUrl?: string;
  clearWebhookUrl?: boolean;
  // Optional too: a missing field keeps what was saved.
  resendApiKey?: string;
  clearResendApiKey?: boolean;
  emailFrom?: string;
  telegramBotToken?: string;
  clearTelegramBotToken?: boolean;
  telegramChatId?: string;
  smtpHost?: string;
  smtpPort?: string;
  smtpUser?: string;
  smtpPassword?: string;
  clearSmtpPassword?: boolean;
};

export type SaveResult = { ok: true } | { ok: false; errors: Partial<Record<keyof SettingsForm | 'form', string>> };

// Where a key comes from, with only its last 4 characters. `unreadable`: saved with another SETTINGS_SECRET.
export type KeyStatus = { source: 'saved' | 'env' | 'unreadable' | 'none'; hint: string };

export type SettingsView = {
  locked: boolean;
  canStoreKeys: boolean;
  form: SettingsForm;
  ai: { apiKey: KeyStatus };
  paypal: { secret: KeyStatus };
  notifications: { webhookUrl: KeyStatus; resendApiKey: KeyStatus; telegramBotToken: KeyStatus; smtpPassword: KeyStatus };
};

type Stored = {
  business?: { name: string; contactEmails: string[]; refundPolicy: string };
  limits?: typeof DEFAULT_LIMITS;
  ai?: { provider: string; baseUrl: string; agentModel: string; judgeModel: string; apiKey?: string };
  paypal?: { clientId: string; secret?: string };
  notifications?: {
    webhookUrl?: string;
    resendApiKey?: string;
    emailFrom?: string;
    telegramBotToken?: string;
    telegramChatId?: string;
    smtpHost?: string;
    smtpPort?: number;
    smtpUser?: string;
    smtpPassword?: string;
  };
};

const isLocked = (env: Env) => env.SETTINGS_LOCKED === 'true';
const settingsSecret = (env: Env) => (env.SETTINGS_SECRET && env.SETTINGS_SECRET.length >= 16 ? env.SETTINGS_SECRET : undefined);

// Without SETTINGS_SECRET, keys are encrypted with a random key kept in settings.key next to the
// settings, readable only by the server account (in Postgres: a row of its own). It protects a
// copied settings.json, not a copied data folder; SETTINGS_SECRET from a secrets manager protects
// both. Created on the first saved key.
async function withSecret(env: Env, store: SettingsStore, create: boolean): Promise<Env> {
  if (settingsSecret(env)) return env;
  const current = await store.readKey();
  if (current === 'unreadable') return env;
  if (current) return { ...env, SETTINGS_SECRET: current };
  if (!create) return env;
  // Missing or empty: an empty file (left by a crash) never sealed a key, so it can be replaced.
  await store.createKey();
  const created = await store.readKey();
  return created && created !== 'unreadable' ? { ...env, SETTINGS_SECRET: created } : env;
}

// The key, '' when the file is missing or too short to be one, or 'unreadable'.
async function readKeyFile(keyFile: string): Promise<string> {
  try {
    const key = (await readFile(keyFile, 'utf8')).trim();
    return key.length >= 16 ? key : '';
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'ENOENT' ? '' : 'unreadable';
  }
}

// Saves in this process wait for one creation; link() keeps other processes from overwriting it.
const creating = new Map<string, Promise<void>>();

// Written whole to a temp file, then linked or renamed into place, so no reader ever sees it half
// written. Disks without hard links get a rename, after checking again that nobody created it.
async function createKeyFile(keyFile: string): Promise<void> {
  if (await readKeyFile(keyFile)) return;
  await mkdir(dirname(keyFile), { recursive: true });
  const partial = `${keyFile}.${crypto.randomUUID()}.tmp`;
  await writeFile(partial, `${randomBytes(32).toString('hex')}\n`, { mode: 0o600 });
  try {
    await link(partial, keyFile);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    // EEXIST: an empty file to replace, or another process's key to keep.
    if (code !== 'EEXIST' || !(await readKeyFile(keyFile))) await rename(partial, keyFile);
  } finally {
    await unlink(partial).catch(() => {});
  }
}
const splitEmails = (text: string) => text.split(/[\s,;]+/).filter(Boolean);
const hint = (key: string) => `••••${key.length >= 8 ? key.slice(-4) : ''}`;

const isText = (value: unknown) => typeof value === 'string';
const isMinor = (value: unknown) => Number.isSafeInteger(value) && (value as number) > 0;
const isPort = (value: unknown) => Number.isInteger(value) && (value as number) >= 1 && (value as number) <= 65_535;
// The submission port, where most mail hosts expect a login with STARTTLS.
const SMTP_PORT = 587;
const SECTION_SHAPES: Record<keyof Stored, (section: Record<string, unknown>) => boolean> = {
  business: (b) => isText(b.name) && isText(b.refundPolicy) && Array.isArray(b.contactEmails) && b.contactEmails.every(isText),
  limits: (l) => isText(l.currency) && isMinor(l.autoRefundUpTo) && isMinor(l.approvalUpTo) && isMinor(l.dailyCap),
  ai: (a) => isText(a.provider) && isText(a.baseUrl) && isText(a.agentModel) && isText(a.judgeModel) && (a.apiKey === undefined || isText(a.apiKey)),
  paypal: (p) => isText(p.clientId) && (p.secret === undefined || isText(p.secret)),
  notifications: (n) =>
    ['webhookUrl', 'resendApiKey', 'emailFrom', 'telegramBotToken', 'telegramChatId', 'smtpHost', 'smtpUser', 'smtpPassword'].every((name) => n[name] === undefined || isText(n[name])) &&
    (n.smtpPort === undefined || isPort(n.smtpPort)),
};

// What was saved; nothing when the file doesn't exist. A file that can't be read or parsed, or a
// section edited into the wrong shape, is logged and ignored, so the server falls back to the
// environment for it instead of failing.
async function readStored(store: SettingsStore): Promise<Stored> {
  let parsed: unknown;
  try {
    const json = await store.read();
    if (json === undefined) return {};
    parsed = JSON.parse(json);
  } catch (error) {
    console.error(`Ignoring ${store.where}: it could not be read`, error);
    return {};
  }
  const stored: Record<string, unknown> = {};
  for (const [name, valid] of Object.entries(SECTION_SHAPES)) {
    const section = (parsed as Record<string, unknown> | null)?.[name];
    if (section === undefined) continue;
    if (section && typeof section === 'object' && valid(section as Record<string, unknown>)) stored[name] = section;
    else console.error(`Ignoring the "${name}" settings in ${store.where}: they are not in the expected shape`);
  }
  return stored as Stored;
}

type Key = { value: string; status: KeyStatus };

function savedKey(sealed: string | undefined, env: Env): Key | undefined {
  if (!sealed) return undefined;
  const secret = settingsSecret(env);
  const value = secret && openSecret(sealed, secret);
  return value ? { value, status: { source: 'saved', hint: hint(value) } } : { value: '', status: { source: 'unreadable', hint: '' } };
}

// An environment key only ever goes to the environment's own endpoint or client id, so changing
// the URL on the page can't send it elsewhere.
function envKey(value: string | undefined, matches: boolean): Key {
  return matches && value ? { value, status: { source: 'env', hint: hint(value) } } : { value: '', status: { source: 'none', hint: '' } };
}

function resolve(stored: Stored, env: Env) {
  const limits = stored.limits ?? DEFAULT_LIMITS;
  const money = (minor: number) => ({ minor, currency: limits.currency });

  const baseUrl = stored.ai?.baseUrl ?? normalizeBaseUrl(env.LLM_BASE_URL ?? '');
  // Models come from /settings only; empty means the provider's default (catalog.withDefaultModels).
  const agentModel = stored.ai?.agentModel ?? '';
  const aiKey = savedKey(stored.ai?.apiKey, env) ?? envKey(env.LLM_API_KEY, baseUrl === normalizeBaseUrl(env.LLM_BASE_URL ?? ''));

  const clientId = stored.paypal?.clientId || env.PAYPAL_CLIENT_ID || '';
  const payPalSecret = savedKey(stored.paypal?.clientId ? stored.paypal.secret : undefined, env) ?? envKey(env.PAYPAL_SECRET, clientId === env.PAYPAL_CLIENT_ID);

  // Its token is the only secret in a webhook URL, and it goes nowhere but that URL.
  const webhookUrl = savedKey(stored.notifications?.webhookUrl, env) ?? envKey(env.GUARD_WEBHOOK_URL, true);
  // Both only ever go to their own fixed API (Resend, Telegram), whatever sender or chat is typed.
  const resendApiKey = savedKey(stored.notifications?.resendApiKey, env) ?? envKey(env.RESEND_API_KEY, true);
  const botToken = savedKey(stored.notifications?.telegramBotToken, env) ?? envKey(env.TELEGRAM_BOT_TOKEN, true);
  // The SMTP password goes only to the server and login it was saved or set for: saveSettings drops
  // a saved one when either changes, and the environment's needs both of the environment's.
  const smtpHost = stored.notifications?.smtpHost || env.SMTP_HOST || '';
  const smtpUser = stored.notifications?.smtpUser || env.SMTP_USER || '';
  const envPort = Number(env.SMTP_PORT);
  const smtpPort = stored.notifications?.smtpPort ?? (isPort(envPort) ? envPort : SMTP_PORT);
  const smtpPassword =
    savedKey(stored.notifications?.smtpHost ? stored.notifications.smtpPassword : undefined, env) ??
    envKey(env.SMTP_PASSWORD, smtpHost === env.SMTP_HOST && smtpUser === env.SMTP_USER);

  const settings: ShopSettings = {
    business: stored.business ?? {
      name: 'Demo shop',
      contactEmails: splitEmails(env.SHOP_CONTACT_EMAIL ?? ''),
      refundPolicy: DEFAULT_REFUND_POLICY,
    },
    limits: { approvalThreshold: money(limits.autoRefundUpTo), perRefund: money(limits.approvalUpTo), daily: money(limits.dailyCap) },
    ai: {
      provider: stored.ai?.provider ?? providerFor(baseUrl),
      baseUrl,
      apiKey: aiKey.value,
      agentModel,
      judgeModel: stored.ai?.judgeModel || agentModel,
    },
    paypal: { clientId, secret: payPalSecret.value },
    notifications: {
      webhookUrl: webhookUrl.value,
      email: { resendApiKey: resendApiKey.value, from: stored.notifications?.emailFrom || env.NOTIFY_EMAIL_FROM || '' },
      smtp: { host: smtpHost, port: smtpPort, user: smtpUser, password: smtpPassword.value },
      telegram: { botToken: botToken.value, chatId: stored.notifications?.telegramChatId || env.TELEGRAM_CHAT_ID || '' },
    },
  };
  const keys = { ai: aiKey.status, paypal: payPalSecret.status, webhook: webhookUrl.status, resend: resendApiKey.status, telegram: botToken.status, smtp: smtpPassword.status };
  return { settings, limits, keys };
}

// AGENT_MODEL and JUDGE_MODEL were read before the models moved to /settings: say once (per value)
// that they no longer are, so a host that still sets them knows why another model runs.
let warnedModels: string | undefined;
function warnRetiredModelVariables(env: Env) {
  const set = [env.AGENT_MODEL, env.JUDGE_MODEL].filter(Boolean).join(',');
  if (!set || set === warnedModels) return;
  warnedModels = set;
  console.warn('AGENT_MODEL and JUDGE_MODEL are no longer read: choose the models on /settings (until then the provider default runs).');
}

export async function loadSettings(options: SettingsOptions = {}): Promise<ShopSettings> {
  const { env = process.env } = options;
  warnRetiredModelVariables(env);
  const store = await storeFor(options);
  return resolve(await readStored(store), await withSecret(env, store, false)).settings;
}

// As the owner types it: "100.00", or "5000" in a currency without decimals.
const decimal = (minor: number, currency: string) => (minor / 100).toFixed(currencyFor(currency)?.decimals ?? 2);

// What the page shows: every value except the keys, which appear only as their last 4 characters.
export async function settingsView(options: SettingsOptions = {}): Promise<SettingsView> {
  const { env = process.env } = options;
  const store = await storeFor(options);
  const stored = await readStored(store);
  const { settings, limits, keys } = resolve(stored, await withSecret(env, store, false));
  return {
    locked: isLocked(env),
    canStoreKeys: !isLocked(env),
    form: {
      name: settings.business.name,
      contactEmails: settings.business.contactEmails.join(', '),
      refundPolicy: settings.business.refundPolicy,
      currency: limits.currency,
      autoRefundUpTo: decimal(limits.autoRefundUpTo, limits.currency),
      approvalUpTo: decimal(limits.approvalUpTo, limits.currency),
      dailyCap: decimal(limits.dailyCap, limits.currency),
      provider: settings.ai.provider,
      baseUrl: settings.ai.baseUrl,
      agentModel: settings.ai.agentModel,
      judgeModel: stored.ai?.judgeModel ?? '',
      apiKey: '',
      paypalClientId: settings.paypal.clientId,
      paypalSecret: '',
      webhookUrl: '',
      resendApiKey: '',
      emailFrom: settings.notifications.email.from,
      telegramBotToken: '',
      telegramChatId: settings.notifications.telegram.chatId,
      smtpHost: settings.notifications.smtp.host,
      smtpPort: String(settings.notifications.smtp.port),
      smtpUser: settings.notifications.smtp.user,
      smtpPassword: '',
    },
    ai: { apiKey: keys.ai },
    paypal: { secret: keys.paypal },
    notifications: { webhookUrl: keys.webhook, resendApiKey: keys.resend, telegramBotToken: keys.telegram, smtpPassword: keys.smtp },
  };
}

// "12", "12.5" or "12.50" in minor units; undefined for anything else or for 0.
function toMinor(text: string): number | undefined {
  const match = /^(\d{1,9})(?:\.(\d{1,2}))?$/.exec(text.trim());
  if (!match) return undefined;
  const minor = Number(match[1]) * 100 + Number((match[2] ?? '').padEnd(2, '0'));
  return minor > 0 ? minor : undefined;
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MODEL = /^\S{1,200}$/;
// A numeric user, group or channel id (groups and channels are negative), or @channelname.
const CHAT_ID = /^(-?\d{1,20}|@\w{1,64})$/;
// BotFather's shape, 123456789:AA…: it becomes part of the API URL, so nothing else may get in.
const BOT_TOKEN = /^\d{1,20}:[\w-]{1,200}$/;
// A host name or IP address: letters, digits, dots and dashes, nothing that could carry a path or port.
const HOST = /^[a-z0-9.-]{1,253}$/i;

export async function saveSettings(form: SettingsForm, options: SettingsOptions = {}): Promise<SaveResult> {
  const { env = process.env } = options;
  if (isLocked(env)) return { ok: false, errors: { form: 'Settings are read-only on this server (SETTINGS_LOCKED).' } };
  const errors: Extract<SaveResult, { ok: false }>['errors'] = {};

  const name = form.name.trim();
  if (!name || name.length > 80) errors.name = 'Enter the business name.';
  const contactEmails = splitEmails(form.contactEmails);
  const badEmail = contactEmails.find((email) => !EMAIL.test(email));
  if (badEmail) errors.contactEmails = `Not an email: ${badEmail}`;
  const refundPolicy = form.refundPolicy.replace(/\r\n?/g, '\n').trim();
  if (refundPolicy.length < 20 || refundPolicy.length > 4000) errors.refundPolicy = 'Describe the refund policy in at least 20 characters.';

  const currency = form.currency.trim();
  const known = currencyFor(currency);
  if (!known) errors.currency = 'Choose a currency PayPal supports.';
  const amount = 'Enter an amount above 0 with at most 2 decimals.';
  const [autoRefundUpTo, approvalUpTo, dailyCap] = [form.autoRefundUpTo, form.approvalUpTo, form.dailyCap].map(toMinor);
  if (autoRefundUpTo === undefined) errors.autoRefundUpTo = amount;
  if (approvalUpTo === undefined) errors.approvalUpTo = amount;
  if (dailyCap === undefined) errors.dailyCap = amount;
  if (known?.decimals === 0) {
    const whole = `${currency} has no decimals: enter a whole amount.`;
    for (const name of ['autoRefundUpTo', 'approvalUpTo', 'dailyCap'] as const) {
      if (form[name].includes('.') && !errors[name]) errors[name] = whole;
    }
  }
  if (autoRefundUpTo !== undefined && approvalUpTo !== undefined && autoRefundUpTo > approvalUpTo) {
    errors.autoRefundUpTo = 'Automatic refunds must stay within the approval limit.';
  }

  const baseUrl = normalizeBaseUrl(form.baseUrl);
  if (!/^https?:\/\/[^\s/]+/i.test(baseUrl) || !URL.canParse(baseUrl)) errors.baseUrl = 'Enter an http(s) URL.';
  const agentModel = form.agentModel.trim();
  if (agentModel && !MODEL.test(agentModel)) errors.agentModel = 'Model ids have no spaces.';
  const judgeModel = form.judgeModel.trim();
  if (judgeModel && !MODEL.test(judgeModel)) errors.judgeModel = 'Model ids have no spaces.';
  const paypalClientId = form.paypalClientId.trim();
  if (paypalClientId && !/^[\w-]{1,200}$/.test(paypalClientId)) errors.paypalClientId = 'Paste the client ID from developer.paypal.com.';

  const apiKey = form.apiKey.trim();
  const paypalSecret = form.paypalSecret.trim();
  // Keys travel in HTTP headers, which can't hold spaces or control characters.
  const badKey = 'Paste the key without spaces or line breaks.';
  if (/[\s\p{Cc}]/u.test(apiKey)) errors.apiKey = badKey;
  if (paypalSecret && !paypalClientId) errors.paypalClientId = 'Enter the client ID that goes with this secret.';
  if (/[\s\p{Cc}]/u.test(paypalSecret)) errors.paypalSecret = badKey;
  const webhookUrl = (form.webhookUrl ?? '').trim();
  if (webhookUrl && (!/^https:\/\/[^\s/]+/i.test(webhookUrl) || /[\s\p{Cc}]/u.test(webhookUrl) || !URL.canParse(webhookUrl))) {
    errors.webhookUrl = 'Enter the https:// webhook URL from Slack or Discord.';
  }
  const resendApiKey = (form.resendApiKey ?? '').trim();
  if (/[\s\p{Cc}]/u.test(resendApiKey)) errors.resendApiKey = badKey;
  const emailFrom = form.emailFrom?.trim();
  if (emailFrom && (emailFrom.length > 200 || !EMAIL.test(emailFrom))) errors.emailFrom = 'Enter the sender address, e.g. guard@your-domain.com.';
  const telegramBotToken = (form.telegramBotToken ?? '').trim();
  if (telegramBotToken && !BOT_TOKEN.test(telegramBotToken)) errors.telegramBotToken = 'Paste the token from @BotFather, like 123456789:AA…';
  const telegramChatId = form.telegramChatId?.trim();
  if (telegramChatId && !CHAT_ID.test(telegramChatId)) errors.telegramChatId = 'Enter a chat id like 123456789 or -1001234567890, or @channelname.';
  const smtpHost = form.smtpHost?.trim();
  if (smtpHost && !HOST.test(smtpHost)) errors.smtpHost = "Enter the mail server's name, e.g. smtp.gmail.com.";
  const smtpPortText = form.smtpPort?.trim();
  const smtpPort = smtpPortText ? Number(smtpPortText) : undefined;
  if (smtpPortText && (!/^\d+$/.test(smtpPortText) || !isPort(smtpPort))) errors.smtpPort = 'Enter a port number, e.g. 587 or 465.';
  const smtpUser = form.smtpUser?.trim();
  if (smtpUser && (smtpUser.length > 200 || /[\s\p{Cc}]/u.test(smtpUser))) errors.smtpUser = 'Enter the login without spaces, usually your email address.';
  const smtpPassword = (form.smtpPassword ?? '').trim();
  if (/\p{Cc}/u.test(smtpPassword)) errors.smtpPassword = 'Paste the password without line breaks.';
  if (smtpPassword && (!smtpHost || !smtpUser) && !errors.smtpHost) errors.smtpHost = 'Enter the server and login this password is for.';
  if (Object.keys(errors).length) return { ok: false, errors };

  const sealing = Boolean(apiKey || paypalSecret || webhookUrl || resendApiKey || telegramBotToken || smtpPassword);
  const store = await storeFor(options);
  const secret = sealing ? settingsSecret(await withSecret(env, store, true)) : undefined;
  // An empty or unreadable settings.key (e.g. left by a crash) can't encrypt anything.
  if (sealing && !secret) {
    return { ok: false, errors: { form: `Keys cannot be stored: ${store.keyLabel} is unreadable or empty. Delete it and save again.` } };
  }
  const previous = await readStored(store);
  // A saved key stays only with the endpoint or client id it was saved for.
  const keepApiKey = !form.clearApiKey && previous.ai?.baseUrl === baseUrl ? previous.ai.apiKey : undefined;
  const keepPaypalSecret = !form.clearPaypalSecret && previous.paypal?.clientId === paypalClientId ? previous.paypal.secret : undefined;
  const keepWebhookUrl = form.clearWebhookUrl ? undefined : previous.notifications?.webhookUrl;
  const keepResendApiKey = form.clearResendApiKey ? undefined : previous.notifications?.resendApiKey;
  const keepBotToken = form.clearTelegramBotToken ? undefined : previous.notifications?.telegramBotToken;
  // Missing fields (an older form) keep what was saved; the password stays only with its server and login.
  const nextSmtpHost = smtpHost ?? previous.notifications?.smtpHost;
  const nextSmtpUser = smtpUser ?? previous.notifications?.smtpUser;
  const sameSmtpServer = nextSmtpHost === previous.notifications?.smtpHost && nextSmtpUser === previous.notifications?.smtpUser;
  const keepSmtpPassword = !form.clearSmtpPassword && sameSmtpServer ? previous.notifications?.smtpPassword : undefined;
  const stored: Stored = {
    business: { name, contactEmails, refundPolicy },
    limits: { currency, autoRefundUpTo: autoRefundUpTo!, approvalUpTo: approvalUpTo!, dailyCap: dailyCap! },
    ai: {
      provider: /^[a-z0-9-]{1,40}$/.test(form.provider) ? form.provider : 'custom',
      baseUrl,
      agentModel,
      judgeModel,
      apiKey: apiKey ? sealSecret(apiKey, secret!) : keepApiKey,
    },
    paypal: { clientId: paypalClientId, secret: paypalSecret ? sealSecret(paypalSecret, secret!) : keepPaypalSecret },
    notifications: {
      webhookUrl: webhookUrl ? sealSecret(webhookUrl, secret!) : keepWebhookUrl,
      resendApiKey: resendApiKey ? sealSecret(resendApiKey, secret!) : keepResendApiKey,
      // Plain fields: blank clears them, a form without them keeps what was saved.
      emailFrom: emailFrom ?? previous.notifications?.emailFrom,
      telegramBotToken: telegramBotToken ? sealSecret(telegramBotToken, secret!) : keepBotToken,
      telegramChatId: telegramChatId ?? previous.notifications?.telegramChatId,
      smtpHost: nextSmtpHost,
      smtpPort: smtpPortText === undefined ? previous.notifications?.smtpPort : smtpPort,
      smtpUser: nextSmtpUser,
      smtpPassword: smtpPassword ? sealSecret(smtpPassword, secret!) : keepSmtpPassword,
    },
  };

  await store.write(`${JSON.stringify(stored, null, 2)}\n`);
  return { ok: true };
}

// The keys a "Test connection" press may use: the one typed, else a saved or environment key, but
// only for the URL or client id it belongs to, so the form can't send a stored key elsewhere.
export async function testCredentials(form: SettingsForm, options: SettingsOptions = {}) {
  const store = await storeFor(options);
  const env = await withSecret(options.env ?? process.env, store, false);
  const stored = await readStored(store);
  const baseUrl = normalizeBaseUrl(form.baseUrl);
  const clientId = form.paypalClientId.trim();
  // Same choice as the agent makes (resolve): a saved key for this URL, even unreadable, wins over the environment's.
  const savedApiKey = stored.ai?.baseUrl === baseUrl ? savedKey(stored.ai.apiKey, env) : undefined;
  const apiKey = form.apiKey.trim() || (savedApiKey ?? envKey(env.LLM_API_KEY, baseUrl === normalizeBaseUrl(env.LLM_BASE_URL ?? ''))).value;
  const savedSecret = clientId && stored.paypal?.clientId === clientId ? savedKey(stored.paypal.secret, env) : undefined;
  const secret = form.paypalSecret.trim() || (savedSecret ?? envKey(env.PAYPAL_SECRET, clientId === env.PAYPAL_CLIENT_ID)).value;
  return { ai: { baseUrl, apiKey }, paypal: { clientId, secret } };
}
