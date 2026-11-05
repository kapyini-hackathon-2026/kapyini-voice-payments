import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateSend, parseAmount, emailHint } from '../src/rules.js';
import { amountInWords } from '../web/src/lib/words.js';

const contacts = [{ id: 'amine', name: 'Amine Benali', email: 'amine@gmail.com' }];
const ctx = { contacts, currencies: ['EUR', 'USD'], limitCents: 20000 };

test('parseAmount accepts comma and dot, rejects garbage', () => {
  assert.deepEqual(parseAmount('50'), { cents: 5000, value: '50.00' });
  assert.deepEqual(parseAmount('12,5'), { cents: 1250, value: '12.50' });
  assert.equal(parseAmount('12.505'), null);
  assert.equal(parseAmount('-3'), null);
  assert.equal(parseAmount('cinquante'), null);
  assert.equal(parseAmount(''), null);
});

test('a valid request passes and is normalised', () => {
  const r = validateSend({ contactId: 'amine', amount: '50', currency: 'eur' }, ctx);
  assert.equal(r.ok, true);
  assert.deepEqual(r.request, { contactId: 'amine', amount: '50.00', amountCents: 5000, currency: 'EUR' });
});

test('every rule produces its own error code', () => {
  assert.deepEqual(validateSend({ contactId: 'nobody', amount: '5', currency: 'EUR' }, ctx).errors, ['UNKNOWN_CONTACT']);
  assert.deepEqual(validateSend({ contactId: 'amine', amount: '0', currency: 'EUR' }, ctx).errors, ['AMOUNT_NOT_POSITIVE']);
  assert.deepEqual(validateSend({ contactId: 'amine', amount: '200.01', currency: 'EUR' }, ctx).errors, ['ABOVE_LIMIT']);
  assert.deepEqual(validateSend({ contactId: 'amine', amount: '5', currency: 'MAD' }, ctx).errors, ['UNSUPPORTED_CURRENCY']);
  assert.deepEqual(validateSend({ contactId: 'amine', amount: '5' }, ctx).errors, ['UNSUPPORTED_CURRENCY']);
});

test('the same payment twice within two minutes is blocked unless explicitly allowed', () => {
  const now = Date.now();
  const operations = [{ contactId: 'amine', amount: '50.00', currency: 'EUR', state: 'completed', createdAt: now - 30_000 }];
  const input = { contactId: 'amine', amount: '50', currency: 'EUR' };
  assert.deepEqual(validateSend(input, { ...ctx, operations, now }).errors, ['POSSIBLE_DUPLICATE']);
  assert.equal(validateSend({ ...input, allowDuplicate: true }, { ...ctx, operations, now }).ok, true);
  // A cancelled attempt does not count as a duplicate.
  operations[0].state = 'cancelled';
  assert.equal(validateSend(input, { ...ctx, operations, now }).ok, true);
});

test('emailHint shows only the domain', () => {
  assert.equal(emailHint('amine@gmail.com'), 'gmail.com');
});

test('amounts are spelled out correctly in French and English', () => {
  assert.equal(amountInWords('50.00', 'EUR', 'fr'), 'cinquante euros');
  assert.equal(amountInWords('1.00', 'EUR', 'fr'), 'un euro');
  assert.equal(amountInWords('71.00', 'EUR', 'fr'), 'soixante et onze euros');
  assert.equal(amountInWords('80.00', 'EUR', 'fr'), 'quatre-vingts euros');
  assert.equal(amountInWords('91.00', 'EUR', 'fr'), 'quatre-vingt-onze euros');
  assert.equal(amountInWords('200.00', 'EUR', 'fr'), 'deux cents euros');
  assert.equal(amountInWords('21.50', 'EUR', 'fr'), 'vingt et un euros et cinquante centimes');
  assert.equal(amountInWords('2000.00', 'USD', 'fr'), 'deux mille dollars');
  assert.equal(amountInWords('50.20', 'EUR', 'en'), 'fifty euros and twenty cents');
  assert.equal(amountInWords('115.00', 'USD', 'en'), 'one hundred fifteen dollars');
});
