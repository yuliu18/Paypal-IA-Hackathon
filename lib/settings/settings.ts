// The shop's own configuration, edited on /settings: who the business is, its refund policy and
// limits, which AI provider and models run the agent and the judge, its PayPal credentials and the
// webhook that announces held refunds. Saved in data/settings.json with the keys (the webhook URL
// included) encrypted (./secret-box). The AI provider, its key, PayPal and the webhook fall back to
// the environment, everything else to the demo defaults; the models are chosen
// here only.
// Server-side only: it returns the keys in plain text to the code that calls the providers.

import { link, mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { dirname, join } from 'node:path';
import type { Limits } from '@/lib/guard/domain/policy';
import { currencyFor } from './currencies.ts';
import { normalizeBaseUrl, providerFor } from './providers.ts';
import { openSecret, sealSecret } from './secret-box.ts';

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
export type SettingsOptions = { file?: string; env?: Env };

export type ShopSettings = {
  business: { name: string; contactEmails: string[]; refundPolicy: string };
  limits: Limits;
  ai: { provider: string; baseUrl: string; apiKey: string; agentModel: string; judgeModel: string };
  paypal: { clientId: string; secret: string };
  // Empty: held refunds wait on /guard without telling anyone.
  notifications: { webhookUrl: string };
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
  notifications: { webhookUrl: KeyStatus };
};

type Stored = {
  business?: { name: string; contactEmails: string[]; refundPolicy: string };
  limits?: typeof DEFAULT_LIMITS;
  ai?: { provider: string; baseUrl: string; agentModel: string; judgeModel: string; apiKey?: string };
  paypal?: { clientId: string; secret?: string };
  notifications?: { webhookUrl?: string };
};

const isLocked = (env: Env) => env.SETTINGS_LOCKED === 'true';
const settingsSecret = (env: Env) => (env.SETTINGS_SECRET && env.SETTINGS_SECRET.length >= 16 ? env.SETTINGS_SECRET : undefined);

// Without SETTINGS_SECRET, keys are encrypted with a random key kept in settings.key next to the
// settings, readable only by the server account. It protects a copied settings.json, not a copied
// data folder; SETTINGS_SECRET from a secrets manager protects both. Created on the first saved key.
async function withSecret(env: Env, file: string, create: boolean): Promise<Env> {
  if (settingsSecret(env)) return env;
  const keyFile = join(dirname(file), 'settings.key');
  const current = await readKeyFile(keyFile);
  if (current === 'unreadable') return env;
  if (current) return { ...env, SETTINGS_SECRET: current };
  if (!create) return env;
  // Missing or empty: an empty file (left by a crash) never sealed a key, so it can be replaced.
  let pending = creating.get(keyFile);
  if (!pending) {
    pending = createKeyFile(keyFile).finally(() => creating.delete(keyFile));
    creating.set(keyFile, pending);
  }
  await pending;
  const created = await readKeyFile(keyFile);
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
const SECTION_SHAPES: Record<keyof Stored, (section: Record<string, unknown>) => boolean> = {
  business: (b) => isText(b.name) && isText(b.refundPolicy) && Array.isArray(b.contactEmails) && b.contactEmails.every(isText),
  limits: (l) => isText(l.currency) && isMinor(l.autoRefundUpTo) && isMinor(l.approvalUpTo) && isMinor(l.dailyCap),
  ai: (a) => isText(a.provider) && isText(a.baseUrl) && isText(a.agentModel) && isText(a.judgeModel) && (a.apiKey === undefined || isText(a.apiKey)),
  paypal: (p) => isText(p.clientId) && (p.secret === undefined || isText(p.secret)),
  notifications: (n) => n.webhookUrl === undefined || isText(n.webhookUrl),
};

// What was saved; nothing when the file doesn't exist. A file that can't be read or parsed, or a
// section edited into the wrong shape, is logged and ignored, so the server falls back to the
// environment for it instead of failing.
async function readStored(file: string): Promise<Stored> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(await readFile(file, 'utf8'));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') console.error(`Ignoring ${file}: it could not be read`, error);
    return {};
  }
  const stored: Record<string, unknown> = {};
  for (const [name, valid] of Object.entries(SECTION_SHAPES)) {
    const section = (parsed as Record<string, unknown> | null)?.[name];
    if (section === undefined) continue;
    if (section && typeof section === 'object' && valid(section as Record<string, unknown>)) stored[name] = section;
    else console.error(`Ignoring the "${name}" settings in ${file}: they are not in the expected shape`);
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
    notifications: { webhookUrl: webhookUrl.value },
  };
  return { settings, limits, keys: { ai: aiKey.status, paypal: payPalSecret.status, webhook: webhookUrl.status } };
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

export async function loadSettings({ env = process.env, file = env.SETTINGS_FILE ?? SETTINGS_FILE }: SettingsOptions = {}): Promise<ShopSettings> {
  warnRetiredModelVariables(env);
  return resolve(await readStored(file), await withSecret(env, file, false)).settings;
}

// As the owner types it: "100.00", or "5000" in a currency without decimals.
const decimal = (minor: number, currency: string) => (minor / 100).toFixed(currencyFor(currency)?.decimals ?? 2);

// What the page shows: every value except the keys, which appear only as their last 4 characters.
export async function settingsView({ env = process.env, file = env.SETTINGS_FILE ?? SETTINGS_FILE }: SettingsOptions = {}): Promise<SettingsView> {
  const stored = await readStored(file);
  const { settings, limits, keys } = resolve(stored, await withSecret(env, file, false));
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
    },
    ai: { apiKey: keys.ai },
    paypal: { secret: keys.paypal },
    notifications: { webhookUrl: keys.webhook },
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

export async function saveSettings(form: SettingsForm, { env = process.env, file = env.SETTINGS_FILE ?? SETTINGS_FILE }: SettingsOptions = {}): Promise<SaveResult> {
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
  if (Object.keys(errors).length) return { ok: false, errors };

  const sealing = Boolean(apiKey || paypalSecret || webhookUrl);
  const secret = sealing ? settingsSecret(await withSecret(env, file, true)) : undefined;
  // An empty or unreadable settings.key (e.g. left by a crash) can't encrypt anything.
  if (sealing && !secret) {
    return { ok: false, errors: { form: 'Keys cannot be stored: settings.key, next to the settings file, is unreadable or empty. Delete it and save again.' } };
  }
  const previous = await readStored(file);
  // A saved key stays only with the endpoint or client id it was saved for.
  const keepApiKey = !form.clearApiKey && previous.ai?.baseUrl === baseUrl ? previous.ai.apiKey : undefined;
  const keepPaypalSecret = !form.clearPaypalSecret && previous.paypal?.clientId === paypalClientId ? previous.paypal.secret : undefined;
  const keepWebhookUrl = form.clearWebhookUrl ? undefined : previous.notifications?.webhookUrl;
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
    notifications: { webhookUrl: webhookUrl ? sealSecret(webhookUrl, secret!) : keepWebhookUrl },
  };

  await mkdir(dirname(file), { recursive: true });
  // A temp name per save, so two saves at once never rename each other's file.
  const partial = `${file}.${process.pid}.${crypto.randomUUID()}.tmp`;
  await writeFile(partial, `${JSON.stringify(stored, null, 2)}\n`, { mode: 0o600 });
  await rename(partial, file);
  return { ok: true };
}

// The keys a "Test connection" press may use: the one typed, else a saved or environment key, but
// only for the URL or client id it belongs to, so the form can't send a stored key elsewhere.
export async function testCredentials(form: SettingsForm, { env: given = process.env, file = given.SETTINGS_FILE ?? SETTINGS_FILE }: SettingsOptions = {}) {
  const env = await withSecret(given, file, false);
  const stored = await readStored(file);
  const baseUrl = normalizeBaseUrl(form.baseUrl);
  const clientId = form.paypalClientId.trim();
  // Same choice as the agent makes (resolve): a saved key for this URL, even unreadable, wins over the environment's.
  const savedApiKey = stored.ai?.baseUrl === baseUrl ? savedKey(stored.ai.apiKey, env) : undefined;
  const apiKey = form.apiKey.trim() || (savedApiKey ?? envKey(env.LLM_API_KEY, baseUrl === normalizeBaseUrl(env.LLM_BASE_URL ?? ''))).value;
  const savedSecret = clientId && stored.paypal?.clientId === clientId ? savedKey(stored.paypal.secret, env) : undefined;
  const secret = form.paypalSecret.trim() || (savedSecret ?? envKey(env.PAYPAL_SECRET, clientId === env.PAYPAL_CLIENT_ID)).value;
  return { ai: { baseUrl, apiKey }, paypal: { clientId, secret } };
}
