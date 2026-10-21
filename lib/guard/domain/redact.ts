// Redaction of free text crossing the shop's boundary: card numbers in a ticket never reach the
// agent, the intent judge or the black box, and a reply to a customer never carries a card number
// or anyone else's email. Card numbers are recognised by their Luhn check digit.

const CARD_CANDIDATE = /\b\d(?:[ -]?\d){12,18}\b/g;
const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;

function passesLuhn(digits: string): boolean {
  let sum = 0;
  for (let i = 0; i < digits.length; i++) {
    let digit = Number(digits[digits.length - 1 - i]);
    if (i % 2 === 1) digit = digit * 2 > 9 ? digit * 2 - 9 : digit * 2;
    sum += digit;
  }
  return sum % 10 === 0;
}

function maskCards(text: string): { text: string; removed: number } {
  let removed = 0;
  const masked = text.replace(CARD_CANDIDATE, (match) => {
    const digits = match.replace(/\D/g, '');
    if (!passesLuhn(digits)) return match;
    removed += 1;
    return `[card •••• ${digits.slice(-4)}]`;
  });
  return { text: masked, removed };
}

export function privateTicket<T extends { message: string }>(ticket: T): { ticket: T; removed: number } {
  const { text, removed } = maskCards(ticket.message);
  return { ticket: { ...ticket, message: text }, removed };
}

export function privateReply(reply: string, customerEmail: string): { reply: string; removed: number } {
  const cards = maskCards(reply);
  let removed = cards.removed;
  const text = cards.text.replace(EMAIL, (email) => {
    if (email.toLowerCase() === customerEmail.toLowerCase()) return email;
    removed += 1;
    return '[email removed]';
  });
  return { reply: text, removed };
}

// For screens: enough to tell customers apart without showing the address.
export function maskEmail(email: string): string {
  const at = email.indexOf('@');
  return at < 1 ? email : `${email[0]}***${email.slice(at)}`;
}

// For log text shown on a screen (reasons, arguments): every email masked, every card number cut to its last 4.
export function maskPersonalData(text: string): string {
  return maskCards(text).text.replace(EMAIL, maskEmail);
}
