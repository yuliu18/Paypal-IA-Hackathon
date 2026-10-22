// The shop's own configuration, edited on /settings: who the business is, its refund policy and
// limits, which AI provider and models run the agent and the judge, and its PayPal credentials.
// Saved in data/settings.json with the keys encrypted (./secret-box). Every value falls back to
// the environment, then to the demo defaults, so an unconfigured server behaves as before.
// Server-side only: it returns the keys in plain text to the code that calls the providers.

import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { Limits } from '@/lib/guard/domain/policy';
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
};

type Stored = {
  business?: { name: string; contactEmails: string[]; refundPolicy: string };
  limits?: typeof DEFAULT_LIMITS;
  ai?: { provider: string; baseUrl: string; agentModel: string; judgeModel: string; apiKey?: string };
  paypal?: { clientId: string; secret?: string };
};

const isLocked = (env: Env) => env.SETTINGS_LOCKED === 'true';
const settingsSecret = (env: Env) => (env.SETTINGS_SECRET && env.SETTINGS_SECRET.length >= 16 ? env.SETTINGS_SECRET : undefined);
const splitEmails = (text: string) => text.split(/[\s,;]+/).filter(Boolean);
const hint = (key: string) => `••••${key.length >= 8 ? key.slice(-4) : ''}`;

async function readStored(file: string): Promise<Stored> {
  try {
    return JSON.parse(await readFile(file, 'utf8')) as Stored;
  } catch {
    return {};
  }
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

  const baseUrl = stored.ai?.baseUrl ?? env.LLM_BASE_URL ?? '';
  const agentModel = stored.ai?.agentModel ?? env.AGENT_MODEL ?? '';
  const aiKey = savedKey(stored.ai?.apiKey, env) ?? envKey(env.LLM_API_KEY, baseUrl === env.LLM_BASE_URL);

  const clientId = stored.paypal?.clientId || env.PAYPAL_CLIENT_ID || '';
  const payPalSecret = savedKey(stored.paypal?.clientId ? stored.paypal.secret : undefined, env) ?? envKey(env.PAYPAL_SECRET, clientId === env.PAYPAL_CLIENT_ID);

  const settings: ShopSettings = {
    business: stored.business ?? {
      name: 'Demo shop',
      contactEmails: splitEmails(env.SHOP_CONTACT_EMAIL ?? ''),
      refundPolicy: DEFAULT_REFUND_POLICY,
    },
    limits: { approvalThreshold: money(limits.autoRefundUpTo), perRefund: money(limits.approvalUpTo), daily: money(limits.dailyCap) },
    ai: {
      provider: stored.ai?.provider ?? 'custom',
      baseUrl,
      apiKey: aiKey.value,
      agentModel,
      judgeModel: (stored.ai ? stored.ai.judgeModel : env.JUDGE_MODEL) || agentModel,
    },
    paypal: { clientId, secret: payPalSecret.value },
  };
  return { settings, limits, keys: { ai: aiKey.status, paypal: payPalSecret.status } };
}

export async function loadSettings({ env = process.env, file = env.SETTINGS_FILE ?? SETTINGS_FILE }: SettingsOptions = {}): Promise<ShopSettings> {
  return resolve(await readStored(file), env).settings;
}

const decimal = (minor: number) => (minor / 100).toFixed(2);

// What the page shows: every value except the keys, which appear only as their last 4 characters.
export async function settingsView({ env = process.env, file = env.SETTINGS_FILE ?? SETTINGS_FILE }: SettingsOptions = {}): Promise<SettingsView> {
  const stored = await readStored(file);
  const { settings, limits, keys } = resolve(stored, env);
  return {
    locked: isLocked(env),
    canStoreKeys: !!settingsSecret(env),
    form: {
      name: settings.business.name,
      contactEmails: settings.business.contactEmails.join(', '),
      refundPolicy: settings.business.refundPolicy,
      currency: limits.currency,
      autoRefundUpTo: decimal(limits.autoRefundUpTo),
      approvalUpTo: decimal(limits.approvalUpTo),
      dailyCap: decimal(limits.dailyCap),
      provider: settings.ai.provider,
      baseUrl: settings.ai.baseUrl,
      agentModel: settings.ai.agentModel,
      judgeModel: stored.ai ? stored.ai.judgeModel : (env.JUDGE_MODEL ?? ''),
      apiKey: '',
      paypalClientId: settings.paypal.clientId,
      paypalSecret: '',
    },
    ai: { apiKey: keys.ai },
    paypal: { secret: keys.paypal },
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
  const refundPolicy = form.refundPolicy.trim();
  if (refundPolicy.length < 20 || refundPolicy.length > 4000) errors.refundPolicy = 'Describe the refund policy in at least 20 characters.';

  const currency = form.currency.trim();
  if (!/^[A-Z]{3}$/.test(currency)) errors.currency = 'Use a 3-letter currency code, like USD or EUR.';
  const amount = 'Enter an amount above 0 with at most 2 decimals.';
  const [autoRefundUpTo, approvalUpTo, dailyCap] = [form.autoRefundUpTo, form.approvalUpTo, form.dailyCap].map(toMinor);
  if (autoRefundUpTo === undefined) errors.autoRefundUpTo = amount;
  if (approvalUpTo === undefined) errors.approvalUpTo = amount;
  if (dailyCap === undefined) errors.dailyCap = amount;
  if (autoRefundUpTo !== undefined && approvalUpTo !== undefined && autoRefundUpTo > approvalUpTo) {
    errors.autoRefundUpTo = 'Automatic refunds must stay within the approval limit.';
  }

  const baseUrl = form.baseUrl.trim().replace(/\/+$/, '');
  if (!/^https?:\/\/[^\s/]+/.test(baseUrl) || !URL.canParse(baseUrl)) errors.baseUrl = 'Enter an http(s) URL.';
  const agentModel = form.agentModel.trim();
  if (!MODEL.test(agentModel)) errors.agentModel = 'Choose the agent model.';
  const judgeModel = form.judgeModel.trim();
  if (judgeModel && !MODEL.test(judgeModel)) errors.judgeModel = 'Model ids have no spaces.';
  const paypalClientId = form.paypalClientId.trim();
  if (paypalClientId && !/^[\w-]{1,200}$/.test(paypalClientId)) errors.paypalClientId = 'Paste the client ID from developer.paypal.com.';

  const apiKey = form.apiKey.trim();
  const paypalSecret = form.paypalSecret.trim();
  const secret = settingsSecret(env);
  const noSecret = (variable: string) => `Set SETTINGS_SECRET (16+ characters) on the server to store keys here, or use ${variable}.`;
  if (apiKey && !secret) errors.apiKey = noSecret('LLM_API_KEY');
  if (paypalSecret && !secret) errors.paypalSecret = noSecret('PAYPAL_SECRET');
  if (Object.keys(errors).length) return { ok: false, errors };

  const previous = await readStored(file);
  // A saved key stays only with the endpoint or client id it was saved for.
  const keepApiKey = !form.clearApiKey && previous.ai?.baseUrl === baseUrl ? previous.ai.apiKey : undefined;
  const keepPaypalSecret = !form.clearPaypalSecret && previous.paypal?.clientId === paypalClientId ? previous.paypal.secret : undefined;
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
  };

  await mkdir(dirname(file), { recursive: true });
  const partial = `${file}.${process.pid}.tmp`;
  await writeFile(partial, `${JSON.stringify(stored, null, 2)}\n`, { mode: 0o600 });
  await rename(partial, file);
  return { ok: true };
}
