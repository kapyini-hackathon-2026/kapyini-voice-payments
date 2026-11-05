// End-to-end test of the "send money" flow against a fake PayPal server.
// It proves our own logic (rules, states, idempotency, honesty of the result).
// It does NOT prove the real Sandbox behaves the same: that must be tested by hand.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createApp } from '../src/app.js';
import { createPayPalClient } from '../src/paypal.js';
import { createStore } from '../src/store.js';

let fake, app, fakeUrl, appUrl, store;
const orders = new Map();
const seenCaptureIds = new Map();
const calls = [];
const invoice = { status: 'SENT' };

function startFakePayPal() {
  const f = express();
  f.use(express.urlencoded({ extended: false }));
  f.use(express.json());
  f.post('/v1/oauth2/token', (req, res) => res.json({ access_token: 'fake-token', expires_in: 32400 }));
  f.post('/v2/checkout/orders', (req, res) => {
    calls.push({ type: 'create', headers: req.headers, body: req.body });
    const id = `ORDER${orders.size + 1}`;
    orders.set(id, { id, status: 'PAYER_ACTION_REQUIRED', body: req.body });
    res.status(200).json({ id, status: 'PAYER_ACTION_REQUIRED', links: [{ rel: 'payer-action', href: `https://sandbox.paypal.test/checkoutnow?token=${id}` }] });
  });
  f.post('/v2/checkout/orders/:id/capture', (req, res) => {
    calls.push({ type: 'capture', headers: req.headers });
    const order = orders.get(req.params.id);
    const mock = req.headers['paypal-mock-response'];
    if (mock?.includes('INSTRUMENT_DECLINED')) {
      return res.status(422).json({ name: 'UNPROCESSABLE_ENTITY', details: [{ issue: 'INSTRUMENT_DECLINED' }], debug_id: 'dbg1' });
    }
    const rid = req.headers['paypal-request-id'];
    if (order.captured && seenCaptureIds.get(order.id) !== rid) {
      return res.status(422).json({ name: 'UNPROCESSABLE_ENTITY', details: [{ issue: 'ORDER_ALREADY_CAPTURED' }] });
    }
    order.captured = true;
    order.status = 'COMPLETED';
    seenCaptureIds.set(order.id, rid);
    res.json(represent(order));
  });
  f.get('/v2/checkout/orders/:id', (req, res) => res.json(represent(orders.get(req.params.id))));
  // Invoicing v2: one open bill for the payer.
  f.post('/v2/invoicing/search-invoices', (req, res) => {
    calls.push({ type: 'search-invoices', body: req.body });
    res.json({ total_items: 1, items: [{ id: 'INV2-TEST', status: invoice.status }] });
  });
  f.get('/v2/invoicing/invoices/:id', (req, res) => res.json({
    id: req.params.id, status: invoice.status,
    detail: { currency_code: 'EUR', payment_term: { due_date: '2026-11-15' }, metadata: { recipient_view_url: 'https://sandbox.paypal.test/invoice/p/#INV2-TEST' } },
    invoicer: { business_name: 'Électricité Démo (Sandbox)' },
    amount: { currency_code: 'EUR', value: '45.00' }, due_amount: { currency_code: 'EUR', value: '45.00' },
  }));
  return new Promise((r) => { const s = f.listen(0, () => r(s)); });
}

function represent(order) {
  return {
    id: order.id,
    status: order.status,
    purchase_units: order.captured
      ? [{ payments: { captures: [{ id: `CAP-${order.id}`, status: 'COMPLETED', create_time: '2026-10-29T20:00:00Z' }] } }]
      : [{}],
  };
}

before(async () => {
  fake = await startFakePayPal();
  fakeUrl = `http://127.0.0.1:${fake.address().port}`;
  const paypal = createPayPalClient({ clientId: 'id', secret: 'secret', baseUrl: fakeUrl });
  const contacts = [{ id: 'amine', name: 'Amine Benali', email: 'amine@personal.example.com' }];
  const server = createApp({
    config: { environment: 'sandbox', appUrl: 'http://app.test', currencies: ['EUR', 'USD'], limitCents: 20000, payerEmail: 'payer@personal.example.com' },
    contacts,
    store: (store = createStore()),
    paypal,
  });
  app = await new Promise((r) => { const s = server.listen(0, () => r(s)); });
  appUrl = `http://127.0.0.1:${app.address().port}`;
});

after(() => { fake.close(); app.close(); });

const post = (path, body) => fetch(appUrl + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
const get = (path) => fetch(appUrl + path, { redirect: 'manual' });

async function sendAndApprove(amount, { simulateDecline = false } = {}) {
  const prep = await (await post('/api/send/prepare', { contactId: 'amine', amount, currency: 'EUR' })).json();
  const conf = await (await post('/api/send/confirm', { prepareId: prep.prepareId, simulateDecline })).json();
  const orderId = new URL(conf.approveUrl).searchParams.get('token');
  return { prep, conf, orderId };
}

test('happy path: prepare, confirm, approve, capture, completed', async () => {
  const { prep, conf, orderId } = await sendAndApprove('50');
  assert.equal(prep.summary.amount, '50.00');
  assert.equal(prep.summary.recipient.hint, 'personal.example.com');

  const created = calls.find((c) => c.type === 'create');
  assert.equal(created.body.purchase_units[0].payee.email_address, 'amine@personal.example.com');
  assert.equal(created.body.purchase_units[0].amount.value, '50.00');
  assert.ok(created.headers['paypal-request-id'], 'order creation must be idempotent');
  assert.match(created.body.payment_source.paypal.experience_context.return_url, /^http:\/\/app\.test\/paypal\/return\?op=/);

  const back = await get(`/paypal/return?op=${conf.operationId}&token=${orderId}&PayerID=X`);
  assert.equal(back.status, 302);
  assert.equal(back.headers.get('location'), `/#result/${conf.operationId}`);

  const { operation } = await (await get(`/api/operations/${conf.operationId}`)).json();
  assert.equal(operation.state, 'completed');
  assert.equal(operation.captureId, `CAP-${orderId}`);
});

test('a confirmation can only be used once', async () => {
  const prep = await (await post('/api/send/prepare', { contactId: 'amine', amount: '7', currency: 'EUR' })).json();
  assert.equal((await post('/api/send/confirm', { prepareId: prep.prepareId })).status, 200);
  const again = await post('/api/send/confirm', { prepareId: prep.prepareId });
  assert.equal(again.status, 410);
});

test('returning twice from PayPal never captures twice', async () => {
  const { conf, orderId } = await sendAndApprove('8');
  await get(`/paypal/return?op=${conf.operationId}&token=${orderId}`);
  const capturesBefore = calls.filter((c) => c.type === 'capture').length;
  await get(`/paypal/return?op=${conf.operationId}&token=${orderId}`);
  assert.equal(calls.filter((c) => c.type === 'capture').length, capturesBefore);
});

test('a forged return with another order id is refused', async () => {
  const { conf } = await sendAndApprove('9');
  await get(`/paypal/return?op=${conf.operationId}&token=SOMEONE-ELSE`);
  const { operation } = await (await get(`/api/operations/${conf.operationId}`)).json();
  assert.equal(operation.state, 'failed');
  assert.equal(operation.reason, 'ORDER_MISMATCH');
});

test('a PayPal decline is reported as declined, with its reason', async () => {
  const { conf, orderId } = await sendAndApprove('10', { simulateDecline: true });
  await get(`/paypal/return?op=${conf.operationId}&token=${orderId}`);
  const mockHeader = calls.filter((c) => c.type === 'capture').at(-1).headers['paypal-mock-response'];
  assert.match(mockHeader, /INSTRUMENT_DECLINED/);
  const { operation } = await (await get(`/api/operations/${conf.operationId}`)).json();
  assert.equal(operation.state, 'failed');
  assert.equal(operation.reason, 'INSTRUMENT_DECLINED');
});

test('cancelling on PayPal marks the operation cancelled', async () => {
  const { conf } = await sendAndApprove('11');
  await get(`/paypal/cancel?op=${conf.operationId}`);
  const { operation } = await (await get(`/api/operations/${conf.operationId}`)).json();
  assert.equal(operation.state, 'cancelled');
});

test('rules are enforced on the server, not only in the browser', async () => {
  const res = await post('/api/send/prepare', { contactId: 'amine', amount: '500', currency: 'EUR' });
  assert.equal(res.status, 422);
  assert.deepEqual((await res.json()).errors, ['ABOVE_LIMIT']);
});

test('payment request: listed with its payer link, paid on PayPal, then verified from the invoice status', async () => {
  const list = await (await get('/api/invoices')).json();
  assert.equal(list.invoices.length, 1);
  assert.equal(list.invoices[0].merchant, 'Électricité Démo (Sandbox)');
  assert.equal(calls.find((c) => c.type === 'search-invoices').body.recipient_email, 'payer@personal.example.com');

  const pay = await (await post('/api/invoices/INV2-TEST/pay', {})).json();
  assert.match(pay.payUrl, /invoice/);
  let op = (await (await get(`/api/operations/${pay.operationId}?refresh=1`)).json()).operation;
  assert.equal(op.state, 'awaiting_approval', 'not paid yet: never announced as done');

  invoice.status = 'PAID'; // the payer paid on PayPal's page
  op = (await (await get(`/api/operations/${pay.operationId}?refresh=1`)).json()).operation;
  assert.equal(op.state, 'completed');
  assert.equal(op.merchant, 'Électricité Démo (Sandbox)');
  assert.equal((await post('/api/invoices/INV2-TEST/pay', {})).status, 409, 'a paid bill cannot be paid twice');
});

test('a payment prepared by voice on a device with a passkey needs the fingerprint for that payment', async () => {
  await store.kvSet('passkeys', [{ id: 'cred-1', publicKey: 'AAAA', counter: 0, transports: [] }]);
  let r = await (await post('/api/agent', { text: 'Envoie 30 euros à Amine', draft: {} })).json();
  r = await (await post('/api/agent', { text: 'oui', draft: r.draft })).json();
  assert.equal(r.reply.params.method, 'passkey');
  const noFinger = await post('/api/send/confirm', { prepareId: r.prepareId });
  assert.equal(noFinger.status, 403);
  const forged = await post('/api/send/confirm', { prepareId: r.prepareId, passkey: { id: 'cred-1', response: {} } });
  assert.equal(forged.status, 403, 'a made-up signature is refused');
  // The keyboard path (classic mode) is not affected: PayPal's approval page authorises it.
  const prep = await (await post('/api/send/prepare', { contactId: 'amine', amount: '31', currency: 'EUR' })).json();
  assert.equal((await post('/api/send/confirm', { prepareId: prep.prepareId })).status, 200);
  await store.kvSet('passkeys', []);
});
