// Deterministic safety rules. No AI here: these checks decide whether a payment
// may even be proposed to the user. The AI (next step) will only fill the same
// structured request that the form fills today: { contactId, amount, currency }.

export const DUPLICATE_WINDOW_MS = 2 * 60 * 1000;

// "50", "50.5", "50,50" → "50.00" / "50.50". Returns null when not a valid amount.
export function parseAmount(input) {
  if (typeof input === 'number') input = String(input);
  if (typeof input !== 'string') return null;
  const s = input.trim().replace(/\s/g, '').replace(',', '.');
  if (!/^\d{1,6}(\.\d{1,2})?$/.test(s)) return null;
  const cents = Math.round(Number(s) * 100);
  if (!Number.isFinite(cents)) return null;
  return { cents, value: (cents / 100).toFixed(2) };
}

/**
 * @returns {{ ok: true, request: object } | { ok: false, errors: string[] }}
 * Error codes are stable strings; the interface turns them into sentences.
 */
export function validateSend(input, { contacts, currencies, limitCents, operations = [], now = Date.now() }) {
  const errors = [];

  const contact = contacts.find((c) => c.id === input?.contactId);
  if (!contact) errors.push('UNKNOWN_CONTACT');

  const amount = parseAmount(input?.amount);
  if (!amount) errors.push('INVALID_AMOUNT');
  else if (amount.cents <= 0) errors.push('AMOUNT_NOT_POSITIVE');
  else if (amount.cents > limitCents) errors.push('ABOVE_LIMIT');

  // Never guess a currency: it must be named and supported.
  const currency = typeof input?.currency === 'string' ? input.currency.toUpperCase() : '';
  if (!currencies.includes(currency)) errors.push('UNSUPPORTED_CURRENCY');

  if (errors.length === 0 && !input.allowDuplicate) {
    const duplicate = operations.find(
      (op) =>
        op.contactId === contact.id &&
        op.amount === amount.value &&
        op.currency === currency &&
        !['cancelled', 'failed'].includes(op.state) &&
        now - op.createdAt < DUPLICATE_WINDOW_MS,
    );
    if (duplicate) errors.push('POSSIBLE_DUPLICATE');
  }

  if (errors.length) return { ok: false, errors };
  return {
    ok: true,
    request: { contactId: contact.id, amount: amount.value, amountCents: amount.cents, currency },
  };
}

// Only the domain of an e-mail is shown, to tell two homonyms apart without exposing the address.
export function emailHint(email) {
  const at = email.lastIndexOf('@');
  return at === -1 ? '' : email.slice(at + 1);
}
