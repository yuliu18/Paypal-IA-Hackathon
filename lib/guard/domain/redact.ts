// Redaction of free text crossing the shop's boundary: card numbers in a ticket never reach the
// agent, the intent judge or the black box, and a reply to a customer never carries a card number
// or anyone else's email. Card numbers are recognised by their Luhn check digit.

// Digits in groups split by up to 3 spaces (any kind, line breaks included), dots or dashes; a card
// is any run of whole groups with 13-19 digits that passes Luhn, so "4111 1111 1111 1111 12/30" is
// found but a card is never cut out of a longer unseparated number. Digits glued to letters belong
// to an id (PayPal's are letters and digits) and are left alone.
const DIGIT_RUN = /(?<![\p{L}\p{N}])\d(?:[\s.-]{0,3}\d)*(?![\p{L}\p{N}])/gu;
// Letters of any script; an apostrophe only inside the name, so a quoted address isn't swallowed.
const EMAIL = /[\p{L}\p{N}._%+-][\p{L}\p{N}._%+'-]*@[\p{L}\p{N}.-]+\.\p{L}{2,}/gu;

function passesLuhn(digits: string): boolean {
  let sum = 0;
  for (let i = 0; i < digits.length; i++) {
    let digit = Number(digits[digits.length - 1 - i]);
    if (i % 2 === 1) digit = digit * 2 > 9 ? digit * 2 - 9 : digit * 2;
    sum += digit;
  }
  return sum % 10 === 0;
}

// The longest card number starting at group `first`, as the index of its last group.
function cardEndingAt(groups: RegExpExecArray[], first: number): { last: number; digits: string } | undefined {
  let digits = '';
  let found: { last: number; digits: string } | undefined;
  for (let last = first; last < groups.length && digits.length + groups[last][0].length <= 19; last++) {
    digits += groups[last][0];
    if (digits.length >= 13 && passesLuhn(digits)) found = { last, digits };
  }
  return found;
}

function maskCards(text: string): { text: string; removed: number } {
  let removed = 0;
  const masked = text.replace(DIGIT_RUN, (run) => {
    const groups = [...run.matchAll(/\d+/g)];
    let out = '';
    let copied = 0;
    for (let first = 0; first < groups.length; first++) {
      const card = cardEndingAt(groups, first);
      if (!card) continue;
      const end = groups[card.last].index + groups[card.last][0].length;
      out += `${run.slice(copied, groups[first].index)}[card •••• ${card.digits.slice(-4)}]`;
      copied = end;
      removed += 1;
      first = card.last;
    }
    return out + run.slice(copied);
  });
  return { text: masked, removed };
}

export function privateTicket<T extends { message: string }>(ticket: T): { ticket: T; removed: number } {
  const { text, removed } = maskCards(ticket.message);
  return { ticket: { ...ticket, message: text }, removed };
}

// `shopEmails`: the shop's own contact addresses, which a reply may give out.
export function privateReply(reply: string, customerEmail: string, shopEmails: string[] = []): { reply: string; removed: number } {
  const cards = maskCards(reply);
  let removed = cards.removed;
  const allowed = new Set([customerEmail, ...shopEmails].map((email) => email.toLowerCase()));
  const text = cards.text.replace(EMAIL, (email) => {
    if (allowed.has(email.toLowerCase())) return email;
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
