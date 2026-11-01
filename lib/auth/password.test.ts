import { describe, expect, it } from 'vitest';
import { looksLikeEmail, passwordProblems } from './password';

describe('passwordProblems', () => {
  it('accepts 12 to 128 characters with a lowercase letter, an uppercase letter and a digit', () => {
    expect(passwordProblems('Guard-the-gate-1')).toEqual([]);
    expect(passwordProblems('Abcdefghijk1')).toEqual([]);
  });

  it('names every rule a password breaks', () => {
    expect(passwordProblems('short')).toEqual(['tooShort', 'noUpper', 'noDigit']);
    expect(passwordProblems('ALLUPPERCASE123')).toEqual(['noLower']);
    expect(passwordProblems('nouppercase123')).toEqual(['noUpper']);
    expect(passwordProblems('NoDigitsAtAllHere')).toEqual(['noDigit']);
    expect(passwordProblems(`Aa1${'x'.repeat(126)}`)).toEqual(['tooLong']);
  });
});

describe('looksLikeEmail', () => {
  it('accepts an address with a name, an @ and a domain', () => {
    expect(looksLikeEmail('owner@shop.example')).toBe(true);
  });

  it('refuses anything else', () => {
    for (const value of ['', 'owner', 'owner@', '@shop.example', 'owner@shop', 'a b@shop.example']) expect(looksLikeEmail(value)).toBe(false);
  });
});
