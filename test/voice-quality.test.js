// Kapyiŋi — Gueriatou QA: actual voice/English modules, no payment or network calls.
// Run with npm test. Hardware, browser speech and live Sandbox still need manual QA.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { localCommand } from '../web/src/voice/commands.js';
import { isEcho } from '../web/src/voice/vad.js';
import { isBrief, countSuccess, successCount, FULL_AFTER } from '../web/src/voice/brevity.js';
import { VOICE } from '../web/src/lib/voice-strings.js';
import { STRINGS } from '../web/src/lib/i18n.js';
import { amountInWords } from '../web/src/lib/words.js';

const words = (amount, currency) => amountInWords(amount, currency, 'en');
const speechContext = { words };
const payment = { summary: { amount: '30.50', currency: 'EUR', recipient: { name: 'Fatou' } }, method: 'passkey' };

function withTemporaryStorage(fn) {
  // Storage is device-local in the actual app, so use in-memory storage instead of real data.
  const original = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  const memory = new Map();
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: (key) => memory.has(key) ? memory.get(key) : null,
      setItem: (key, value) => memory.set(key, String(value)),
      removeItem: (key) => memory.delete(key),
    },
  });
  try { fn(); } finally {
    if (original) Object.defineProperty(globalThis, 'localStorage', original);
    else delete globalThis.localStorage;
  }
}

test('English local navigation, language and repeat commands are recognized', () => {
  assert.deepEqual(localCommand('Open my payments'), { nav: '#activity' });
  assert.deepEqual(localCommand('Open settings'), { nav: '#settings' });
  assert.deepEqual(localCommand('Go back'), { nav: 'back' });
  assert.deepEqual(localCommand('Switch to English'), { setting: ['lang', 'en'] });
  assert.deepEqual(localCommand('Speak French'), { setting: ['lang', 'fr'] });
  assert.deepEqual(localCommand('Repeat please'), { repeat: true });
});

test('local commands never accidentally consume a money or contact-mutation request', () => {
  assert.equal(localCommand('Send 20 euros to Fatou'), null);
  assert.equal(localCommand('Add a contact'), null);
  assert.equal(localCommand('Remove a contact'), null);
});

test('echo detection ignores longer echoes, never short user confirmations', () => {
  assert.equal(isEcho('Twenty euros to Fatou', 'Twenty euros to Fatou. Shall I send it?'), true);
  assert.equal(isEcho('Yes', 'Twenty euros to Fatou. Shall I send it?'), false);
  assert.equal(isEcho('Cancel', 'Twenty euros to Fatou. Shall I send it?'), false);
  assert.equal(isEcho('Please stop and change the amount', 'Twenty euros to Fatou. Shall I send it?'), false);
});

test('English money is spoken as words, including cents', () => {
  assert.equal(amountInWords('30.50', 'EUR', 'en'), 'thirty euros and fifty cents');
  assert.equal(amountInWords('1.01', 'USD', 'en'), 'one dollar and one cent');
  assert.equal(amountInWords('12.00', 'EUR', 'en'), 'twelve euros');
});

test('English passkey read-back always contains recipient and the full amount', () => {
  const actual = VOICE.en.agent.CONFIRM_ASK(payment, speechContext);
  assert.match(actual, /Fatou/);
  assert.match(actual, /thirty euros and fifty cents/i);
  assert.match(actual, /\?/);
});

test('English voice fallback requests the spoken amount rather than accepting only Yes', () => {
  const phrase = VOICE.en.agent.CONFIRM_ASK({ ...payment, method: 'amount' }, speechContext);
  assert.match(phrase, /I send thirty euros and fifty cents/i);
  assert.match(STRINGS.en.agent.INVOICE_SAY_AMOUNT({ invoice: { amount: '45.00', currency: 'EUR' } }, speechContext), /“Yes” is not enough/i);
});

test('first launch offers a mode choice; return greeting is brief and includes the name', () => {
  assert.match(VOICE.en.onboard.askMode, /say yes or no/i);
  assert.match(VOICE.en.greet('Awa'), /Hello Awa/);
  assert.match(VOICE.en.greet('Awa'), /What can I do for you\?/i);
});

test('successful payment enables brief mode per account, without double-counting immediate revisit', () => {
  withTemporaryStorage(() => {
    assert.equal(isBrief('qa-account-a'), false);
    countSuccess('qa-account-a', 'op-1');
    assert.equal(isBrief('qa-account-a'), true);
    assert.equal(isBrief('qa-account-b'), false);
    countSuccess('qa-account-a', 'op-1');
    assert.equal(successCount('qa-account-a'), 1);
    countSuccess('qa-account-a', null);
    assert.equal(successCount('qa-account-a'), 1);
    countSuccess('qa-account-a', 'op-2');
    assert.equal(successCount('qa-account-a'), 2);
  });
});

test('help, misunderstood instructions and amount mismatch restore full speech', () => {
  for (const replyCode of ['HELP', 'NOT_UNDERSTOOD', 'AMOUNT_MISMATCH', 'INVOICE_AMOUNT_MISMATCH', 'CONTACT_NOT_FOUND']) {
    assert.ok(FULL_AFTER.has(replyCode), `Missing ${replyCode} recovery code`);
  }
});

test('brief confirmations work in English after the first transaction', () => {
  const phrase = VOICE.en.brief.CONFIRM_ASK(payment, speechContext);
  assert.match(phrase, /Fatou/);
  assert.match(phrase, /thirty euros and fifty cents/i);
  assert.doesNotMatch(phrase, /place your finger/i);
});

test('English first-visit ready prompt invites speech, including without a saved name', () => {
  for (const name of ['Awa', '']) {
    assert.match(VOICE.en.onboard.ready(name), /what can I do for you\?/i);
    assert.doesNotMatch(VOICE.en.onboard.ready(name), /touch the big circle|undefined|null/i);
    assert.match(VOICE.en.onboard.ready(name), /listening/i);
  }
});

test('brief voice and invoice confirmations retain full money details and spoken authorization', () => {
  const send = VOICE.en.brief.CONFIRM_ASK({ ...payment, method: 'amount' }, speechContext);
  assert.match(send, /thirty euros and fifty cents to Fatou/i);
  assert.match(send, /say: I send thirty euros and fifty cents/i);
  const invoice = { amount: '1.01', currency: 'USD', merchant: 'Demo Energy' };
  const pay = VOICE.en.brief.INVOICE_CONFIRM_ASK({ invoice }, speechContext);
  assert.match(pay, /one dollar and one cent to Demo Energy/i);
  assert.match(pay, /say: I pay one dollar and one cent/i);
});

test('English brief prompts cover every French brief prompt and preserve contact errors', () => {
  assert.deepEqual(Object.keys(VOICE.en.brief).sort(), Object.keys(VOICE.fr.brief).sort());
  const phrase = VOICE.en.brief.CT_ASK_EMAIL({ name: 'Fatou', errors: ['CONTACT_EMAIL_INVALID'] });
  assert.match(phrase, /not valid/i);
  assert.match(phrase, /Fatou/);
  assert.match(VOICE.en.brief.CT_REVIEW({ contact: { name: 'Fatou', email: 'qa@example.com' } }), /Fatou, qa at example dot com/i);
});

test('device verification and interruption explanations are English on every supported device', () => {
  assert.deepEqual(Object.keys(VOICE.en.device).sort(), Object.keys(VOICE.fr.device).sort());
  for (const [kind, phrase] of Object.entries(VOICE.en.device)) {
    assert.doesNotMatch(phrase, /Sur ce|Sur cet|votre|empreinte|appareil|vérification/, kind);
    assert.match(phrase, kind === 'privacy' ? /signature/i : /verify you/i, kind);
  }
  assert.match(VOICE.en.device.windows, /PIN/);
  assert.match(VOICE.en.device.iphone, /passcode/);
  assert.match(VOICE.en.bargeIn.label, /interrupt/i);
  assert.match(VOICE.en.bargeIn.hint, /iPhone.*volume/);
});

test('passkey setup and cancellation copy describe device verification with a recovery action', () => {
  assert.match(VOICE.en.onboard.askPasskey, /device passkey/i);
  assert.doesNotMatch(VOICE.en.onboard.passkeyNone, /no fingerprint/i);
  assert.match(VOICE.en.passkeyCancelled, /nothing was sent/i);
  assert.match(VOICE.en.passkeyCancelled, /try again.*cancel/i);
  assert.match(VOICE.en.passkeyRefused, /nothing was sent/i);
  assert.match(VOICE.en.space.login, /passkey/i);
});
