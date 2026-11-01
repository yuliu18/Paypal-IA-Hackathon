// The owner account guards real payments, so its password must be strong: 12 to 128 characters
// (Neon Auth accepts up to 128) with a lowercase letter, an uppercase letter and a digit.

export type PasswordProblem = 'tooShort' | 'tooLong' | 'noLower' | 'noUpper' | 'noDigit';

export const PASSWORD_MIN = 12;
export const PASSWORD_MAX = 128;

export function passwordProblems(password: string): PasswordProblem[] {
  const problems: PasswordProblem[] = [];
  if (password.length < PASSWORD_MIN) problems.push('tooShort');
  if (password.length > PASSWORD_MAX) problems.push('tooLong');
  if (!/\p{Ll}/u.test(password)) problems.push('noLower');
  if (!/\p{Lu}/u.test(password)) problems.push('noUpper');
  if (!/\d/.test(password)) problems.push('noDigit');
  return problems;
}

export const looksLikeEmail = (value: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
