// Contacts by voice: add, change, remove, list. Read back before saving; fingerprint when the space has one.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createAgent } from '../src/agent.js';
import { createApp } from '../src/app.js';
import { createStore } from '../src/store.js';
import { interpretWithRules } from '../src/interpret.js';
import { detectContactAction, parseSpokenEmail, spokenName, nameInAddSentence, spokenAlias } from '../src/contact-talk.js';

test('what was said: actions, addresses, names, nicknames', () => {
  assert.equal(detectContactAction('ajoute un contact'), 'add');
  assert.equal(detectContactAction('Ajoute Fatou Diallo à mes contacts'), 'add');
  assert.equal(detectContactAction('add a new contact'), 'add');
  assert.equal(detectContactAction('supprime Amine de mes contacts'), 'remove');
  assert.equal(detectContactAction('efface mon frère'), 'remove');
  assert.equal(detectContactAction("change l'adresse de mon frère"), 'edit');
  assert.equal(detectContactAction('renomme Eddie'), 'edit');
  assert.equal(detectContactAction('quels sont mes contacts ?'), 'list');
  // Not about contacts.
  assert.equal(detectContactAction('envoie vingt euros à mon frère'), null);
  assert.equal(detectContactAction('change le montant'), null);
  assert.equal(detectContactAction('change la personne'), null);

  assert.equal(parseSpokenEmail('fatou arobase personal point example point com'), 'fatou@personal.example.com');
  assert.equal(parseSpokenEmail("c'est Fatou tiret Diallo arobase gmail point com"), 'fatou-diallo@gmail.com');
  assert.equal(parseSpokenEmail('john underscore doe at example dot org'), 'john_doe@example.org');
  assert.equal(parseSpokenEmail('fatou@personal.example.com'), 'fatou@personal.example.com');
  assert.equal(parseSpokenEmail('je ne sais pas'), null);

  assert.equal(spokenName("elle s'appelle fatou diallo"), 'Fatou Diallo');
  assert.equal(nameInAddSentence('Ajoute Fatou Diallo à mes contacts'), 'Fatou Diallo');
  assert.equal(nameInAddSentence('ajoute un contact'), '');
  assert.equal(spokenAlias('ma tante'), 'ma tante');
  assert.equal(spokenAlias('aucun'), null);
});

const startContacts = [
  { id: 'amine', name: 'Amine Tazi', aliases: ['mon frère'], email: 'amine@personal.example.com' },
  { id: 'eddie', name: 'Eddie Zida', aliases: [], email: 'eddie@personal.example.com' },
];
const config = { currencies: ['EUR'], limitCents: 20000 };

function makeAgent({ passkey = false } = {}) {
  const contacts = structuredClone(startContacts);
  const saved = [];
  const store = createStore().forUser('u1');
  const agent = createAgent({
    contacts, config, store, interpret: interpretWithRules,
    publicContact: (c) => ({ id: c.id, name: c.name, hint: 'example.com' }), publicOperation: (op) => op,
    hasPasskey: async () => passkey,
    saveContact: async (change) => { saved.push(change); return { ok: true, contact: { name: change.name } }; },
  });
  const say = async (...lines) => {
    let draft = {};
    const out = [];
    for (const text of lines) {
      const r = await agent({ text, draft });
      out.push(r);
      draft = r.draft;
    }
    return out;
  };
  return { say, saved, store };
}
const codes = (rs) => rs.map((r) => r.reply.code);

test('adding a contact by voice: name, nickname, address, read-back, then saved', async () => {
  const { say, saved } = makeAgent();
  const out = await say('ajoute un contact', 'Fatou Diallo', 'ma tante', 'fatou arobase personal point example point com', 'oui');
  assert.deepEqual(codes(out), ['CT_ASK_NAME', 'CT_ASK_ALIAS', 'CT_ASK_EMAIL', 'CT_REVIEW', 'CT_SAVED']);
  assert.deepEqual(out[3].reply.params.contact, { name: 'Fatou Diallo', aliases: ['ma tante'], email: 'fatou@personal.example.com' });
  assert.equal(out[4].contactsChanged, true);
  assert.deepEqual(saved, [{ op: 'add', id: null, name: 'Fatou Diallo', aliases: ['ma tante'], email: 'fatou@personal.example.com', aliasAsked: true }]);
});

test('the name said in the first sentence is used; a misheard address is asked again; nothing is saved before "oui"', async () => {
  const { say, saved } = makeAgent();
  const out = await say('Ajoute Fatou Diallo à mes contacts', 'aucun', 'euh je sais pas', 'fatou@personal.example.com', 'non', "l'adresse", 'fatou2 arobase personal point example point com', 'oui');
  assert.deepEqual(codes(out), ['CT_ASK_ALIAS', 'CT_ASK_EMAIL', 'CT_ASK_EMAIL', 'CT_REVIEW', 'CT_FIELD', 'CT_ASK_EMAIL', 'CT_REVIEW', 'CT_SAVED']);
  assert.ok(out[2].reply.params.heard, 'says what it heard');
  assert.equal(saved.length, 1);
  assert.equal(saved[0].email, 'fatou2@personal.example.com');
  assert.deepEqual(saved[0].aliases, []);
});

test('changing and removing by voice; "annule" changes nothing', async () => {
  const a = makeAgent();
  let out = await a.say("change l'adresse de mon frère", 'amine.t arobase personal point example point com', 'oui');
  assert.deepEqual(codes(out), ['CT_ASK_EMAIL', 'CT_REVIEW', 'CT_SAVED']);
  assert.equal(a.saved[0].op, 'edit');
  assert.equal(a.saved[0].id, 'amine');
  assert.equal(a.saved[0].email, 'amine.t@personal.example.com');
  assert.deepEqual(a.saved[0].aliases, ['mon frère'], 'the other fields are kept');

  out = await a.say('supprime un contact', 'le deuxième', 'oui');
  assert.deepEqual(codes(out), ['CT_PICK', 'CT_REMOVE_CONFIRM', 'CT_REMOVED']);
  assert.deepEqual([a.saved[1].op, a.saved[1].id], ['remove', 'eddie']);

  out = await a.say('supprime Eddie', 'non');
  assert.deepEqual(codes(out), ['CT_REMOVE_CONFIRM', 'CT_CANCELLED']);
  out = await a.say('ajoute un contact', 'Binta', 'annule');
  assert.equal(out[2].reply.code, 'CT_CANCELLED');
  assert.equal(a.saved.length, 2);

  out = await a.say('quels sont mes contacts');
  assert.deepEqual(out[0].reply.params.names, ['Amine Tazi', 'Eddie Zida']);
});

test('with a fingerprint in the space, a voice change waits for it', async () => {
  const { say, saved } = makeAgent({ passkey: true });
  const out = await say('supprime Eddie', 'oui');
  assert.equal(out[1].reply.code, 'CT_USE_PASSKEY');
  assert.ok(out[1].prepareId);
  assert.equal(saved.length, 0, 'not saved without the fingerprint');
});

// Through the server: the fingerprint is really checked, and a contact change is not a payment.
let server, base, store;
before(async () => {
  store = createStore();
  const app = createApp({ config: { environment: 'sandbox', appUrl: 'http://app.test', currencies: ['EUR'], limitCents: 20000 }, contacts: startContacts, store, paypal: { createOrder: async () => ({ orderId: 'O1', approveUrl: 'https://x.test/?token=O1' }) } });
  server = await new Promise((r) => { const s = app.listen(0, () => r(s)); });
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => server.close());

test('server: a voice change is saved without a fingerprint, refused with a fake one, never usable as a payment', async () => {
  let cookie = '';
  const post = async (p, body) => {
    const res = await fetch(base + p, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) }, body: JSON.stringify(body) });
    const set = res.headers.get('set-cookie');
    if (set) cookie = set.split(';')[0];
    return { status: res.status, body: await res.json() };
  };
  const { body: { account } } = await post('/api/account', {});
  const talk = async (...lines) => {
    let draft = {};
    let r;
    for (const text of lines) { r = (await post('/api/agent', { text, draft })).body; draft = r.draft; }
    return r;
  };
  // No fingerprint yet: "oui" saves.
  let r = await talk('ajoute Fatou', 'aucun', 'fatou arobase personal point example point com', 'oui');
  assert.equal(r.reply.code, 'CT_SAVED');
  const list = (await (await fetch(`${base}/api/contacts`, { headers: { Cookie: cookie } })).json()).contacts;
  assert.ok(list.some((c) => c.email === 'fatou@personal.example.com'));

  // With a fingerprint: the change waits, a made-up signature is refused, and it cannot pay anyone.
  await store.forUser(account.id).kvSet('passkeys', [{ id: 'cred-1', publicKey: 'AAAA', counter: 0, transports: [] }]);
  r = await talk('supprime Eddie', 'oui');
  assert.equal(r.reply.code, 'CT_USE_PASSKEY');
  assert.equal((await post('/api/send/confirm', { prepareId: r.prepareId })).status, 410);
  await post('/api/passkey/confirm/options', { prepareId: r.prepareId });
  assert.equal((await post('/api/contacts/confirm', { prepareId: r.prepareId, passkey: { id: 'cred-1', response: {} } })).status, 403);
  const after = (await (await fetch(`${base}/api/contacts`, { headers: { Cookie: cookie } })).json()).contacts;
  assert.ok(after.some((c) => c.id === 'eddie'), 'Eddie is still there');
});
