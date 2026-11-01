import type { SettingsForm } from '@/lib/settings/settings';

// The settings page's sections, one shown at a time, and the form fields each one holds, so a
// rejected save can open the section of the field it names. The language is saved on its own, at
// once, in this browser (./language-actions), so it holds no field of the form.
export const SETTINGS_SECTIONS = [
  { id: 'language', label: 'Language', fields: [] },
  { id: 'business', label: 'Business', fields: ['name', 'contactEmails', 'refundPolicy'] },
  { id: 'limits', label: 'Limits', fields: ['currency', 'autoRefundUpTo', 'approvalUpTo', 'dailyCap'] },
  { id: 'ai', label: 'AI model', fields: ['provider', 'baseUrl', 'agentModel', 'judgeModel', 'apiKey'] },
  { id: 'paypal', label: 'PayPal app', fields: ['paypalClientId', 'paypalSecret'] },
  {
    id: 'notifications',
    label: 'Notifications',
    fields: ['webhookUrl', 'resendApiKey', 'emailFrom', 'telegramBotToken', 'telegramChatId', 'smtpHost', 'smtpPort', 'smtpUser', 'smtpPassword'],
  },
] as const satisfies readonly { id: string; label: string; fields: readonly (keyof SettingsForm)[] }[];

export type SettingsSectionId = (typeof SETTINGS_SECTIONS)[number]['id'];

const hasError = (errors: Record<string, string | undefined>, fields: readonly string[]) => fields.some((field) => errors[field]);

export function sectionHasError(errors: Record<string, string | undefined>, id: SettingsSectionId): boolean {
  return hasError(errors, SETTINGS_SECTIONS.find((s) => s.id === id)!.fields);
}

export function firstSectionWithError(errors: Record<string, string | undefined>): SettingsSectionId | undefined {
  return SETTINGS_SECTIONS.find((s) => hasError(errors, s.fields))?.id;
}

// The section the address names (/settings?section=limits), shared by the page and the side menu
// that links to each section; the language when it names none or one that doesn't exist.
export function sectionFrom(value: string | null): SettingsSectionId {
  return SETTINGS_SECTIONS.find((s) => s.id === value)?.id ?? 'language';
}
