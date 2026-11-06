// One Kapyiŋi space per user: contacts, journal, passkeys and settings are never shared.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/app.js';
import { createStore } from '../src/store.js';
import { validateContact } from '../src/accounts.js';

const demo = [
  { id: 'amine', name: 'Amine Tazi', aliases: ['mon frère'], email: 'amine@personal.example.com' },
  { id: 'eddie', name: 'Eddie Zida', aliases: [], email: 'eddie@personal.example.com' },
];
// Just enough of a PayPal client to create an order.
let orders = 0;
const paypal = {
  createOrder: async () => { orders += 1; return { orderId: `O${orders}`, approveUrl: `https://sandbox.paypal.test/checkoutnow?token=O${orders}` }; },
  listOpenInvoices: async () => [],
};

let server, base, store;
before(async () => {
  store = createStore();
  const app = createApp({
    config: { environment: 'sandbox', appUrl: 'http://app.test', currencies: ['EUR'], limitCents: 20000, payerEmail: 'payer@personal.example.com' },
    contacts: demo, store, paypal,
  });
  server = await new Promise((r) => { const s = app.listen(0, () => r(s)); });
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => server.close());

// A browser with its own cookie.
function client() {
  let cookie = '';
  const call = async (path, method = 'GET', body) => {
    const res = await fetch(base + path, {
      method, headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    const set = res.headers.get('set-cookie');
    if (set) cookie = set.split(';')[0];
    return { status: res.status, set, body: await res.json().catch(() => ({})) };
  };
  return {
    get: (p) => call(p),
    post: (p, b = {}) => call(p, 'POST', b),
    patch: (p, b) => call(p, 'PATCH', b),
    del: (p) => call(p, 'DELETE'),
  };
}
async function newSpace(name) {
  const c = client();
  const r = await c.post('/api/account', { name });
  assert.equal(r.status, 201);
  assert.match(r.set, /HttpOnly/);
  assert.match(r.set, /SameSite=Lax/);
  return { c, account: r.body.account };
}

test('without a space, nothing about money, contacts or history is reachable', async () => {
  const c = client();
  const cfg = await c.get('/api/config');
  assert.equal(cfg.body.account, null);
  assert.deepEqual(cfg.body.contacts, []);
  for (const [m, p] of [['post', '/api/agent'], ['get', '/api/contacts'], ['get', '/api/operations'], ['post', '/api/send/prepare'], ['post', '/api/passkey/register/options']]) {
    assert.equal((await c[m](p, {})).status, 401, `${m} ${p}`);
  }
});

test('a new space starts with its own copy of the demo contacts', async () => {
  const a = await newSpace('Awa');
  const b = await newSpace('Moussa');
  assert.notEqual(a.account.id, b.account.id);
  assert.equal(a.account.name, 'Awa');
  assert.equal(a.account.payerEmail, 'payer@personal.example.com');
  assert.deepEqual((await a.c.get('/api/contacts')).body.contacts.map((x) => x.id), ['amine', 'eddie']);

  // Awa adds, renames and removes; Moussa's contacts do not change.
  const added = await a.c.post('/api/contacts', { name: 'Fatou Diallo', aliases: 'ma tante, tata', email: 'Fatou@Personal.Example.com' });
  assert.equal(added.status, 201);
  assert.deepEqual(added.body.contact.aliases, ['ma tante', 'tata']);
  assert.equal(added.body.contact.email, 'fatou@personal.example.com');
  assert.equal((await a.c.patch('/api/contacts/amine', { name: 'Amine T.' })).status, 200);
  assert.equal((await a.c.del('/api/contacts/eddie')).status, 200);

  assert.deepEqual((await a.c.get('/api/config')).body.contacts.map((x) => x.name), ['Amine T.', 'Fatou Diallo']);
  assert.deepEqual((await b.c.get('/api/config')).body.contacts.map((x) => x.name), ['Amine Tazi', 'Eddie Zida']);
  // A contact of another space cannot be touched.
  const fatou = added.body.contact.id;
  assert.equal((await b.c.patch(`/api/contacts/${fatou}`, { name: 'X' })).status, 404);
  assert.equal((await b.c.del(`/api/contacts/${fatou}`)).status, 404);
});

test('contacts are checked: name, Sandbox address, nicknames that name one person only', () => {
  const others = [{ id: 'a', name: 'Amine', email: 'amine@x.com', aliases: ['mon frère'] }];
  assert.deepEqual(validateContact({ name: '', email: 'nope' }, others).errors, ['CONTACT_NAME_MISSING', 'CONTACT_EMAIL_INVALID']);
  assert.deepEqual(validateContact({ name: 'B', email: 'AMINE@x.com' }, others).errors, ['CONTACT_EMAIL_TAKEN']);
  assert.deepEqual(validateContact({ name: 'B', email: 'b@x.com', aliases: ['Mon Frère'] }, others).errors, ['CONTACT_ALIAS_TAKEN']);
  assert.equal(validateContact({ name: '  Binta   Sow ', email: 'b@x.com', aliases: ['ma sœur', 'ma sœur', ''] }, others).contact.name, 'Binta Sow');
  assert.deepEqual(validateContact({ name: 'B', email: 'b@x.com', aliases: ['ma sœur', 'ma sœur', ''] }, others).contact.aliases, ['ma sœur']);
});

test('the journal and prepared payments belong to one space', async () => {
  const a = await newSpace('Awa');
  const b = await newSpace('Moussa');
  const prep = await a.c.post('/api/send/prepare', { contactId: 'amine', amount: '12', currency: 'EUR' });
  assert.equal(prep.status, 200);
  // Moussa cannot confirm Awa's payment, even with its id.
  assert.equal((await b.c.post('/api/send/confirm', { prepareId: prep.body.prepareId })).status, 410);
  const conf = await a.c.post('/api/send/confirm', { prepareId: prep.body.prepareId });
  assert.equal(conf.status, 200);

  assert.equal((await a.c.get('/api/operations')).body.operations.length, 1);
  assert.equal((await b.c.get('/api/operations')).body.operations.length, 0);
  assert.equal((await b.c.get(`/api/operations/${conf.body.operationId}`)).status, 404);

  // A duplicate is a duplicate in one space only: Moussa may send the same amount to the same person.
  assert.equal((await b.c.post('/api/send/prepare', { contactId: 'amine', amount: '12', currency: 'EUR' })).status, 200);
  assert.deepEqual((await a.c.post('/api/send/prepare', { contactId: 'amine', amount: '12', currency: 'EUR' })).body.errors, ['POSSIBLE_DUPLICATE']);

  // Renaming the contact later does not rewrite the journal.
  await a.c.patch('/api/contacts/amine', { name: 'Quelqu’un d’autre' });
  assert.equal((await a.c.get('/api/operations')).body.operations[0].recipient.name, 'Amine Tazi');
});

test('a removed contact cannot be paid, even with a request prepared before', async () => {
  const a = await newSpace('Awa');
  const prep = await a.c.post('/api/send/prepare', { contactId: 'eddie', amount: '5', currency: 'EUR' });
  await a.c.del('/api/contacts/eddie');
  const conf = await a.c.post('/api/send/confirm', { prepareId: prep.body.prepareId });
  assert.equal(conf.status, 422);
  assert.deepEqual(conf.body.errors, ['UNKNOWN_CONTACT']);
});

test('passkeys belong to one space: one user’s fingerprint does not change how another confirms', async () => {
  const a = await newSpace('Awa');
  const b = await newSpace('Moussa');
  await store.forUser(a.account.id).kvSet('passkeys', [{ id: 'cred-awa', publicKey: 'AAAA', counter: 0, transports: [] }]);
  assert.equal((await a.c.get('/api/config')).body.passkeyRegistered, true);
  assert.equal((await b.c.get('/api/config')).body.passkeyRegistered, false);

  const talk = async (c) => {
    let r = (await c.post('/api/agent', { text: 'Envoie 30 euros à Amine', draft: {} })).body;
    r = (await c.post('/api/agent', { text: 'oui', draft: r.draft })).body;
    return r;
  };
  assert.equal((await talk(a.c)).reply.params.method, 'passkey');
  assert.equal((await talk(b.c)).reply.params.method, 'amount');
  // Awa's voice payment needs Awa's signature.
  const r = await talk(a.c);
  assert.equal((await a.c.post('/api/send/confirm', { prepareId: r.prepareId, passkey: { id: 'cred-awa', response: {} } })).status, 403);
});

test('signing in: an unknown passkey opens nothing; leaving closes the space on this device', async () => {
  const a = await newSpace('Awa');
  const opts = await a.c.post('/api/account/login/options');
  assert.ok(opts.body.flowId);
  assert.equal(opts.body.options.userVerification, 'required');
  const bad = await a.c.post('/api/account/login/verify', { flowId: opts.body.flowId, response: { id: 'not-a-passkey', response: {} } });
  assert.equal(bad.status, 401);

  assert.equal((await a.c.post('/api/account/logout')).status, 200);
  assert.equal((await a.c.get('/api/config')).body.account, null);
  assert.equal((await a.c.get('/api/contacts')).status, 401);
});

test('each space has its own PayPal Sandbox address for payment requests', async () => {
  const a = await newSpace('Awa');
  assert.equal((await a.c.patch('/api/account', { payerEmail: 'pas une adresse' })).status, 422);
  const ok = await a.c.patch('/api/account', { payerEmail: 'awa-buyer@personal.example.com', name: 'Awa K.' });
  assert.equal(ok.body.account.payerEmail, 'awa-buyer@personal.example.com');
  assert.equal(ok.body.account.name, 'Awa K.');
  await a.c.patch('/api/account', { payerEmail: '' });
  const cfg = (await a.c.get('/api/config')).body;
  assert.equal(cfg.invoicesReady, false);
  assert.equal((await a.c.get('/api/invoices')).status, 503);
});
