import { describe, expect, it } from 'vitest';
import { firstSectionWithError, sectionFrom, SETTINGS_SECTIONS } from './sections';

describe('settings sections', () => {
  it('lists the sections in the order the menu shows them', () => {
    expect(SETTINGS_SECTIONS.map((s) => s.label)).toEqual(['Language', 'Business and rules', 'AI model', 'PayPal app', 'Notifications']);
  });

  it('opens the first section, in menu order, that holds a field the save rejected', () => {
    expect(firstSectionWithError({ telegramChatId: 'x', approvalUpTo: 'y' })).toBe('business');
    expect(firstSectionWithError({ paypalSecret: 'x' })).toBe('paypal');
    expect(firstSectionWithError({ judgeModel: 'x' })).toBe('ai');
    expect(firstSectionWithError({ smtpPort: 'x' })).toBe('notifications');
    expect(firstSectionWithError({ refundPolicy: 'x' })).toBe('business');
  });

  it('stays where it is when the error belongs to no field', () => {
    expect(firstSectionWithError({ form: 'Could not save' })).toBeUndefined();
    expect(firstSectionWithError({})).toBeUndefined();
  });

  it('keeps the shop, its refund policy and its limits in one section', () => {
    expect(SETTINGS_SECTIONS.find((s) => s.id === 'business')?.fields).toEqual(['name', 'contactEmails', 'refundPolicy', 'currency', 'autoRefundUpTo', 'approvalUpTo', 'dailyCap']);
  });

  it('puts the language first, which holds no field of the settings form', () => {
    expect(SETTINGS_SECTIONS[0]).toMatchObject({ id: 'language', fields: [] });
  });
});

describe('sectionFrom', () => {
  it("opens the section the address names, and the language when it names none or an unknown one", () => {
    expect(sectionFrom('ai')).toBe('ai');
    expect(sectionFrom('api-keys')).toBe('language');
    expect(sectionFrom(null)).toBe('language');
    expect(sectionFrom('nope')).toBe('language');
  });

  it('opens the business section for the limits and the documents, sections of their own before', () => {
    expect(sectionFrom('limits')).toBe('business');
    expect(sectionFrom('documents')).toBe('business');
  });
});
