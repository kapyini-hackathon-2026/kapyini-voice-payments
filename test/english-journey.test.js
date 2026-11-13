// Real conversation logic with deterministic interpretation and a fake invoice.
// No Claude calls, PayPal requests, passkey signatures or microphone input.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createAgent } from '../src/agent.js';
import { createStore } from '../src/store.js';
import { interpretWithRules } from '../src/interpret.js';
import { VOICE } from '../web/src/lib/voice-strings.js';
import { STRINGS } from '../web/src/lib/i18n.js';
import { amountInWords } from '../web/src/lib/words.js';

const contacts = [{ id: 'fatou', name: 'Fatou', aliases: ['my sister'], email: 'fatou@example.com' }];
const invoice = { id: 'INV2-QA', status: 'SENT', merchant: 'Demo Energy', amount: '45.50', currency: 'EUR', dueDate: '2026-11-15', items: [], payUrl: 'https://sandbox.example/invoice/INV2-QA' };
const context = {
  words: (amount, currency) => amountInWords(amount, currency, 'en'),
  date: (iso) => iso,
  currencies: () => 'euros or dollars',
  t: STRINGS.en,
};

function conversation({ passkey = false } = {}) {
  const agent = createAgent({
    contacts,
    config: { currencies: ['EUR', 'USD'], limitCents: 20000, payerEmail: 'payer@example.com' },
    store: createStore(),
    interpret: interpretWithRules,
    publicContact: ({ id, name }) => ({ id, name, hint: 'example.com' }),
    publicOperation: (op) => op,
    hasPasskey: async () => passkey,
    paypal: { listOpenInvoices: async () => [invoice], getInvoice: async () => invoice },
  });
  let draft = {};
  return async (text) => {
    const result = await agent({ text, draft, lang: 'en' });
    draft = result.draft;
    const { code, params } = result.reply;
    const render = VOICE.en.agent[code] || STRINGS.en.agent[code];
    assert.equal(typeof render, 'function', `Missing English reply for ${code}`);
    return { ...result, spoken: render(params, context) };
  };
}

test('English payment: review, explicit yes, exact spoken amount including cents', async () => {
  const say = conversation();
  const review = await say('Send thirty euros and fifty cents to Fatou');
  assert.equal(review.reply.code, 'REVIEW');
  assert.equal(review.prepareId, undefined);
  assert.match(review.spoken, /thirty euros and fifty cents for Fatou/i);
  const confirm = await say('yes');
  assert.equal(confirm.reply.code, 'CONFIRM_ASK');
  assert.match(confirm.spoken, /I send thirty euros and fifty cents/i);
  assert.ok(confirm.prepareId);
  const authorized = await say('I send thirty euros and fifty cents');
  assert.equal(authorized.reply.code, 'CONFIRMED');
  assert.equal(authorized.prepareId, confirm.prepareId);
});

test('English confirmation refuses yes, okay and silence as spoken amount authorization', async () => {
  const say = conversation();
  await say('Send 30 euros to Fatou');
  await say('yes');
  for (const text of ['yes', 'okay', '']) {
    const result = await say(text);
    assert.equal(result.reply.code, text ? 'SAY_AMOUNT' : 'NOT_UNDERSTOOD', JSON.stringify(text));
    if (text) assert.match(result.spoken, /“Yes” is not enough/);
    assert.equal(result.draft.stage, 'confirm');
    assert.notEqual(result.reply.code, 'CONFIRMED');
  }
});

test('English amount correction returns to review before a new authorization', async () => {
  const say = conversation();
  await say('Send 30 euros to Fatou');
  const original = await say('yes');
  const mismatch = await say('I send fifty euros');
  assert.equal(mismatch.reply.code, 'AMOUNT_MISMATCH');
  assert.match(mismatch.spoken, /fifty euros.*thirty euros.*Nothing was sent/i);
  const corrected = await say('yes');
  assert.equal(corrected.reply.code, 'REVIEW');
  assert.equal(corrected.reply.params.summary.amount, '50.00');
  const confirm = await say('yes');
  assert.notEqual(confirm.prepareId, original.prepareId);
  assert.equal((await say('I send fifty euros')).reply.code, 'CONFIRMED');
});

test('English cancel and negation never confirm a prepared payment', async () => {
  for (const text of ['cancel', 'I do not send thirty euros']) {
    const say = conversation();
    await say('Send 30 euros to Fatou');
    await say('yes');
    const result = await say(text);
    assert.notEqual(result.reply.code, 'CONFIRMED');
    if (text === 'cancel') {
      assert.equal(result.reply.code, 'CANCELLED');
      assert.deepEqual(result.draft, {});
      assert.match(result.spoken, /won’t send anything/i);
    }
  }
});

test('English passkey journey asks for device verification instead of voice fallback', async () => {
  const say = conversation({ passkey: true });
  await say('Send 30 euros to Fatou');
  const confirm = await say('yes');
  assert.equal(confirm.reply.params.method, 'passkey');
  assert.match(confirm.spoken, /thirty euros to Fatou.*device passkey/i);
  const result = await say('yes');
  assert.equal(result.reply.code, 'USE_PASSKEY');
  assert.match(result.spoken, /fingerprint, face, or unlock code/i);
  // USE_PASSKEY is a request to authenticate, not a verified signature or payment.
  assert.notEqual(result.reply.code, 'CONFIRMED');
});

test('English invoice reads real fixture details and requires the exact spoken amount', async () => {
  const say = conversation();
  const review = await say('I want to pay my invoice');
  assert.equal(review.reply.code, 'INVOICE_REVIEW');
  assert.match(review.spoken, /Demo Energy.*forty-five euros and fifty cents.*2026-11-15/);
  assert.equal((await say('yes')).reply.code, 'INVOICE_CONFIRM_ASK');
  assert.equal((await say('yes')).reply.code, 'INVOICE_SAY_AMOUNT');
  const wrong = await say('I pay forty euros');
  assert.equal(wrong.reply.code, 'INVOICE_AMOUNT_MISMATCH');
  assert.match(wrong.spoken, /Nothing was paid/i);
  const result = await say('I pay forty-five euros and fifty cents');
  assert.equal(result.reply.code, 'INVOICE_CONFIRMED');
  assert.equal(result.reply.params.invoice.id, invoice.id);
  assert.equal(result.payUrl, invoice.payUrl);
  assert.ok(result.operationId);
});

test('KNOWN BUG QA-01: numeric decimal cents survive the rules interpreter', {
  todo: 'Wahon: src/interpret.js plain() removes decimal punctuation; see test/qa/repo-findings-2026-11-10.md',
}, () => {
  const intent = interpretWithRules({ text: 'Send 30.50 euros to Fatou' });
  assert.equal(intent.amount, '30.50');
});
