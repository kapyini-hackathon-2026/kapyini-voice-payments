// How much Kapyiŋi explains: "guided" until the user's first successful payment, "brief" after.
// Brief drops instructions the user already knows ("Dites oui, puis posez votre doigt"), never the
// money: the amount in words and the recipient's name are always said before confirming.
// Kept on this device, per space. "Aide", "répète" or a mistake bring the full sentence back.
import { read, write } from '../storage.js';

const key = (accountId) => `kapyini-success-${accountId || 'none'}`;

export const successCount = (accountId) => Number(read(key(accountId), '0')) || 0;
export const isBrief = (accountId) => successCount(accountId) >= 1;

/** Counts a completed payment once, even if its result page is opened again. */
export function countSuccess(accountId, operationId) {
  const lastKey = `${key(accountId)}-last`;
  if (!operationId || read(lastKey) === operationId) return;
  write(lastKey, operationId);
  write(key(accountId), String(successCount(accountId) + 1));
}

// Replies after which the next sentence is said in full: the user may need the instructions again.
export const FULL_AFTER = new Set([
  'HELP', 'NOT_UNDERSTOOD', 'SAY_AMOUNT', 'AMOUNT_MISMATCH', 'INVOICE_SAY_AMOUNT', 'INVOICE_AMOUNT_MISMATCH',
  'CONTACT_NOT_FOUND', 'INVALID', 'EXPIRED', 'CURRENCY_UNSUPPORTED', 'PASSKEY_HINT', 'CT_FAILED',
]);
