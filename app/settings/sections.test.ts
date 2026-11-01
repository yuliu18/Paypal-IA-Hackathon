import { describe, expect, it } from 'vitest';
import { firstSectionWithError, sectionFrom, SETTINGS_SECTIONS } from './sections';

describe('settings sections', () => {
  it('lists the sections in the order the menu shows them', () => {
    expect(SETTINGS_SECTIONS.map((s) => s.label)).toEqual(['Language', 'Business', 'Limits', 'AI model', 'PayPal app', 'Notifications', 'API keys']);
  });

  it('opens the first section, in menu order, that holds a field the save rejected', () => {
    expect(firstSectionWithError({ telegramChatId: 'x', approvalUpTo: 'y' })).toBe('limits');
    expect(firstSectionWithError({ paypalSecret: 'x' })).toBe('paypal');
    expect(firstSectionWithError({ judgeModel: 'x' })).toBe('ai');
    expect(firstSectionWithError({ smtpPort: 'x' })).toBe('notifications');
    expect(firstSectionWithError({ refundPolicy: 'x' })).toBe('business');
  });

  it('stays where it is when the error belongs to no field', () => {
    expect(firstSectionWithError({ form: 'Could not save' })).toBeUndefined();
    expect(firstSectionWithError({})).toBeUndefined();
  });

  it('puts the API keys last, after the notifications, holding no field of the settings form', () => {
    expect(SETTINGS_SECTIONS.at(-1)).toMatchObject({ id: 'api-keys', fields: [] });
    expect(SETTINGS_SECTIONS.at(-2)?.id).toBe('notifications');
  });

  it('puts the language first, which holds no field of the settings form', () => {
    expect(SETTINGS_SECTIONS[0]).toMatchObject({ id: 'language', fields: [] });
  });
});

describe('sectionFrom', () => {
  it("opens the section the address names, and the language when it names none or an unknown one", () => {
    expect(sectionFrom('limits')).toBe('limits');
    expect(sectionFrom('api-keys')).toBe('api-keys');
    expect(sectionFrom(null)).toBe('language');
    expect(sectionFrom('nope')).toBe('language');
  });
});
