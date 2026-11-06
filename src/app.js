import express from 'express';
import { fileURLToPath } from 'node:url';
import { validateSend, emailHint } from './rules.js';
import { PayPalError, invoiceState } from './paypal.js';
import { createAgent } from './agent.js';
import { interpretWithRules } from './interpret.js';
import { createPasskeys } from './passkey.js';
import { createAccounts, SESSION_DAYS } from './accounts.js';

// The React interface, built by `npm run build` into web/dist.
const PUBLIC_DIR = fileURLToPath(new URL('../web/dist', import.meta.url));

// States an operation can be in. Only "completed" may be announced as "done".
const OPEN_STATES = ['awaiting_approval', 'capturing', 'pending', 'unverified'];

const COOKIE = 'kapyini_session';
function readCookie(req) {
  const part = (req.headers.cookie || '').split(/;\s*/).find((p) => p.startsWith(`${COOKIE}=`));
  return part ? decodeURIComponent(part.slice(COOKIE.length + 1)) : null;
}

export function stateFromSummary(s) {
  if (s.captureStatus === 'COMPLETED') return 'completed';
  if (s.captureStatus === 'PENDING') return 'pending';
  if (s.captureStatus === 'DECLINED' || s.captureStatus === 'FAILED') return 'failed';
  if (s.orderStatus === 'VOIDED') return 'cancelled';
  return 'awaiting_approval';
}

// `contacts` are the demo contacts: each new space starts with a copy of them.
export function createApp({ config, contacts: demoContacts = [], store, paypal, interpret = interpretWithRules, aiName = null, serveStatic = true }) {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '10kb' }));

  const publicContact = (c) => ({ id: c.id, name: c.name, hint: emailHint(c.email), aliases: c.aliases || [] });
  const passkeys = createPasskeys({ store, origins: config.origins || [config.appUrl] });
  const accounts = createAccounts({ store, demoContacts, defaultPayerEmail: config.payerEmail || null });

  // ----- who is asking: the session cookie opens one space -----
  const secure = String(config.appUrl || '').startsWith('https://');
  const cookie = (value, maxAge) => `${COOKIE}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure ? '; Secure' : ''}`;
  const setSession = (res, token) => res.setHeader('Set-Cookie', cookie(token, SESSION_DAYS * 86400));
  const clearSession = (res) => res.setHeader('Set-Cookie', cookie('', 0));

  app.use('/api', async (req, _res, next) => {
    try {
      req.user = await accounts.fromSession(readCookie(req));
      next();
    } catch (err) {
      next(err);
    }
  });

  // Everything about money, contacts or history happens inside the user's own space.
  async function needSpace(req, res, next) {
    if (!req.user) return res.status(401).json({ errors: ['NO_ACCOUNT'] });
    try {
      req.space = {
        user: req.user,
        store: store.forUser(req.user.id),
        contacts: await accounts.contacts(req.user.id),
        payerEmail: req.user.payerEmail || null,
      };
      next();
    } catch (err) {
      next(err);
    }
  }

  async function publicAccount(user) {
    return { id: user.id, name: user.name, payerEmail: user.payerEmail, passkeys: await passkeys.count(user) };
  }

  // The recipient is kept in the operation itself, so the journal stays right after a contact
  // is renamed or removed.
  function publicOperation(op, contacts = []) {
    const contact = op.recipientName ? { name: op.recipientName, email: op.payeeEmail || '' } : contacts.find((c) => c.id === op.contactId);
    return {
      id: op.id,
      kind: op.kind,
      state: op.state,
      amount: op.amount,
      currency: op.currency,
      recipient: contact ? { name: contact.name, hint: emailHint(contact.email) } : null,
      merchant: op.merchant ?? null,
      invoiceId: op.invoiceId ?? null,
      orderId: op.orderId ?? null,
      captureId: op.captureId ?? null,
      reason: op.reason ?? null,
      createdAt: op.createdAt,
      updatedAt: op.updatedAt,
    };
  }

  async function applySummary(op, summary) {
    return store.update(op.id, {
      state: stateFromSummary(summary),
      captureId: summary.captureId,
      reason: summary.captureReason,
    });
  }

  app.get('/api/config', async (req, res) => {
    const user = req.user;
    const contacts = user ? await accounts.contacts(user.id) : [];
    res.json({
      sandboxReady: Boolean(paypal),
      environment: config.environment,
      currencies: config.currencies,
      defaultCurrency: config.currencies[0],
      limit: (config.limitCents / 100).toFixed(2),
      account: user ? await publicAccount(user) : null,
      contacts: contacts.map(publicContact),
      canSimulateDecline: config.environment === 'sandbox',
      invoicesReady: Boolean(paypal && user?.payerEmail),
      trusted: config.trusted?.name ? { name: config.trusted.name, phone: config.trusted.phone || null } : null,
      helpUrl: config.helpUrl,
      ai: aiName,
      storage: store.kind,
      passkeyRegistered: await passkeys.registered(user),
    });
  });

  // ----- the user's space -----
  // Create a space for this device (first launch). If one is already open, it is returned as is.
  app.post('/api/account', async (req, res) => {
    if (req.user) return res.json({ account: await publicAccount(req.user) });
    const user = await accounts.create({ name: req.body?.name });
    setSession(res, await accounts.openSession(user.id));
    res.status(201).json({ account: await publicAccount(user) });
  });

  // First name, and the PayPal Sandbox address where payment requests are looked for.
  app.patch('/api/account', needSpace, async (req, res) => {
    const fields = {};
    for (const k of ['name', 'payerEmail']) if (req.body && k in req.body) fields[k] = req.body[k];
    const r = await accounts.update(req.user.id, fields);
    if (!r.ok) return res.status(422).json({ errors: r.errors });
    res.json({ account: await publicAccount(r.user) });
  });

  // Leave the space on this device. Coming back needs the fingerprint.
  app.post('/api/account/logout', async (req, res) => {
    await accounts.closeSession(readCookie(req));
    clearSession(res);
    res.json({ ok: true });
  });

  // Sign in with the finger: the passkey itself says which space it opens.
  app.post('/api/account/login/options', async (_req, res) => res.json(await passkeys.loginOptions()));
  app.post('/api/account/login/verify', async (req, res) => {
    const userId = await passkeys.verifyLogin(req.body?.flowId, req.body?.response);
    const user = userId ? await accounts.get(userId) : null;
    if (!user) return res.status(401).json({ errors: ['PASSKEY_UNKNOWN'] });
    await accounts.closeSession(readCookie(req));
    setSession(res, await accounts.openSession(user.id));
    res.json({ account: await publicAccount(user) });
  });

  // ----- the user's contacts: their own copy, changed without touching anyone else's -----
  // The full address is shown only here, to its owner, to check or correct it.
  const ownContact = (c) => ({ id: c.id, name: c.name, email: c.email, aliases: c.aliases || [], demo: Boolean(c.demo) });
  app.get('/api/contacts', needSpace, (req, res) => res.json({ contacts: req.space.contacts.map(ownContact) }));
  app.post('/api/contacts', needSpace, async (req, res) => {
    const r = await accounts.addContact(req.user.id, req.body);
    if (!r.ok) return res.status(422).json({ errors: r.errors });
    res.status(201).json({ contact: ownContact(r.contact) });
  });
  app.patch('/api/contacts/:id', needSpace, async (req, res) => {
    const r = await accounts.updateContact(req.user.id, req.params.id, req.body);
    if (!r.ok) return res.status(r.errors.includes('UNKNOWN_CONTACT') ? 404 : 422).json({ errors: r.errors });
    res.json({ contact: ownContact(r.contact) });
  });
  app.delete('/api/contacts/:id', needSpace, async (req, res) => {
    const r = await accounts.removeContact(req.user.id, req.params.id);
    if (!r.ok) return res.status(404).json({ errors: r.errors });
    res.json({ ok: true });
  });

  // The voice agent: one sentence in, the next thing to say out. It never moves money:
  // at most it prepares a request that the user must still confirm.
  app.post('/api/agent', needSpace, async (req, res) => {
    const { text, draft, lang, choiceId } = req.body ?? {};
    const s = req.space;
    const agent = createAgent({
      contacts: s.contacts,
      config: { ...config, payerEmail: s.payerEmail },
      store: s.store,
      interpret,
      publicContact,
      publicOperation: (op) => publicOperation(op, s.contacts),
      paypal,
      hasPasskey: () => passkeys.registered(s.user),
    });
    try {
      res.json(await agent({
        text,
        draft: draft && typeof draft === 'object' ? draft : {},
        lang: lang === 'en' ? 'en' : 'fr',
        choiceId: typeof choiceId === 'string' ? choiceId : null,
      }));
    } catch (err) {
      console.error('agent error', err);
      res.status(500).json({ errors: ['DEFAULT'] });
    }
  });

  // Step 1 — check the request and return what the user must confirm. No money moves.
  app.post('/api/send/prepare', needSpace, async (req, res) => {
    const { contacts, store: own } = req.space;
    const result = validateSend(req.body, {
      contacts,
      currencies: config.currencies,
      limitCents: config.limitCents,
      operations: await own.list(),
    });
    if (!result.ok) return res.status(422).json({ errors: result.errors });
    const contact = contacts.find((c) => c.id === result.request.contactId);
    const prepareId = await own.prepare(result.request);
    res.json({
      prepareId,
      summary: {
        amount: result.request.amount,
        currency: result.request.currency,
        recipient: publicContact(contact),
      },
    });
  });

  // ----- Passkeys: the phone's fingerprint / Face ID. Each space has its own, one per device. -----
  app.post('/api/passkey/register/options', needSpace, async (req, res) => res.json(await passkeys.registrationOptions(req.user)));
  app.post('/api/passkey/register/verify', needSpace, async (req, res) => {
    const r = await passkeys.verifyRegistration(req.user, req.body?.response);
    res.status(r.ok ? 200 : 400).json(r.ok ? { ok: true } : { errors: [r.error] });
  });
  app.post('/api/passkey/reset', needSpace, async (req, res) => { await passkeys.reset(req.user); res.json({ ok: true }); });
  // A challenge for one prepared payment, so the fingerprint confirms that payment and nothing else.
  app.post('/api/passkey/confirm/options', needSpace, async (req, res) => {
    const prepared = await req.space.store.peekPrepared(String(req.body?.prepareId || ''));
    if (!prepared) return res.status(410).json({ errors: ['CONFIRMATION_EXPIRED'] });
    res.json(await passkeys.confirmationOptions(req.user, prepared.id));
  });

  // Step 2 — the user said "I confirm": create the PayPal order and hand back the approval link.
  app.post('/api/send/confirm', needSpace, async (req, res) => {
    if (!paypal) return res.status(503).json({ errors: ['SANDBOX_NOT_CONFIGURED'] });
    const { user, contacts, store: own } = req.space;
    const pending = await own.peekPrepared(String(req.body?.prepareId || ''));
    if (!pending) return res.status(410).json({ errors: ['CONFIRMATION_EXPIRED'] });
    // A request prepared by voice, in a space with a passkey, needs the fingerprint for THIS payment.
    if (pending.channel === 'voice' && (await passkeys.registered(user))) {
      const ok = await passkeys.verifyConfirmation(user, pending, req.body?.passkey);
      if (!ok) return res.status(403).json({ errors: ['PASSKEY_REQUIRED'] });
    }
    // The contact may have been removed since the request was prepared.
    const contact = contacts.find((c) => c.id === pending.contactId);
    if (!contact) return res.status(422).json({ errors: ['UNKNOWN_CONTACT'] });
    const prepared = await own.takePrepared(pending.id);
    if (!prepared) return res.status(410).json({ errors: ['CONFIRMATION_EXPIRED'] });

    const op = await own.createOperation({
      kind: 'send',
      state: 'awaiting_approval',
      contactId: contact.id,
      recipientName: contact.name,
      payeeEmail: contact.email,
      amount: prepared.amount,
      currency: prepared.currency,
      simulateDecline: config.environment === 'sandbox' && req.body?.simulateDecline === true,
    });

    try {
      const order = await paypal.createOrder({
        amount: prepared.amount,
        currency: prepared.currency,
        payeeEmail: contact.email,
        description: `Kapyiŋi: ${contact.name}`,
        returnUrl: `${config.appUrl}/paypal/return?op=${op.id}`,
        cancelUrl: `${config.appUrl}/paypal/cancel?op=${op.id}`,
        requestId: `kapyini-order-${op.id}`,
        locale: req.body?.locale === 'en' ? 'en-US' : 'fr-FR',
      });
      await store.update(op.id, { orderId: order.orderId });
      res.json({ operationId: op.id, approveUrl: order.approveUrl });
    } catch (err) {
      await store.update(op.id, { state: 'failed', reason: err.issue || 'ORDER_CREATION_FAILED' });
      res.status(502).json({ operationId: op.id, errors: [err.issue || 'ORDER_CREATION_FAILED'], debugId: err.debugId });
    }
  });

  // Step 3 — PayPal sends the payer back here after approval. Capture, then show the real result.
  // The operation id (random) and PayPal's token identify the payment; no session is needed here.
  app.get('/paypal/return', async (req, res) => {
    const op = await store.get(String(req.query.op || ''));
    if (!op || !paypal) return res.redirect('/#home');
    const back = `/#result/${op.id}`;

    // The token PayPal appends must be this operation's order: a guard against a forged return.
    if (req.query.token !== op.orderId) {
      await store.update(op.id, { state: 'failed', reason: 'ORDER_MISMATCH' });
      return res.redirect(back);
    }
    if (!['awaiting_approval', 'unverified'].includes(op.state)) return res.redirect(back);

    await store.update(op.id, { state: 'capturing' });
    try {
      const summary = await paypal.captureOrder(op.orderId, {
        requestId: `kapyini-capture-${op.id}`,
        mockResponse: op.simulateDecline ? 'INSTRUMENT_DECLINED' : undefined,
      });
      await applySummary(op, summary);
    } catch (err) {
      if (err instanceof PayPalError && err.issue === 'ORDER_ALREADY_CAPTURED') {
        await applySummary(op, await paypal.getOrder(op.orderId));
      } else if (err instanceof PayPalError && err.status >= 400 && err.status < 500) {
        await store.update(op.id, { state: 'failed', reason: err.issue || err.paypalName || 'CAPTURE_REFUSED' });
      } else {
        // Network or server error: we do not know whether money moved. Say so, never guess.
        await store.update(op.id, { state: 'unverified', reason: 'CAPTURE_UNKNOWN' });
      }
    }
    res.redirect(back);
  });

  app.get('/paypal/cancel', async (req, res) => {
    const op = await store.get(String(req.query.op || ''));
    if (!op) return res.redirect('/#home');
    if (op.state === 'awaiting_approval') await store.update(op.id, { state: 'cancelled', reason: 'PAYER_CANCELLED' });
    res.redirect(`/#result/${op.id}`);
  });

  // ----- Payment requests (PayPal Invoicing v2) sent to the user's own Sandbox address -----
  app.get('/api/invoices', needSpace, async (req, res) => {
    if (!paypal || !req.space.payerEmail) return res.status(503).json({ errors: ['INVOICES_NOT_CONFIGURED'] });
    try {
      res.json({ invoices: await paypal.listOpenInvoices({ recipientEmail: req.space.payerEmail }) });
    } catch (err) {
      res.status(502).json({ errors: [err.issue || 'INVOICES_UNREACHABLE'] });
    }
  });

  // The "Pay" button for sighted users: same journal entry as the voice path, then PayPal's own page.
  app.post('/api/invoices/:id/pay', needSpace, async (req, res) => {
    if (!paypal || !req.space.payerEmail) return res.status(503).json({ errors: ['INVOICES_NOT_CONFIGURED'] });
    let inv;
    try {
      inv = await paypal.getInvoice(req.params.id);
    } catch (err) {
      return res.status(502).json({ errors: [err.issue || 'INVOICES_UNREACHABLE'] });
    }
    if (!['SENT', 'UNPAID', 'PARTIALLY_PAID'].includes(inv.status) || !inv.payUrl) return res.status(409).json({ errors: ['INVOICE_NOT_PAYABLE'] });
    const op = await req.space.store.createOperation({ kind: 'invoice', state: 'awaiting_approval', invoiceId: inv.id, merchant: inv.merchant, amount: inv.amount, currency: inv.currency });
    res.json({ operationId: op.id, payUrl: inv.payUrl });
  });

  app.get('/api/operations', needSpace, async (req, res) => {
    res.json({ operations: (await req.space.store.list()).map((op) => publicOperation(op, req.space.contacts)) });
  });

  // Read one operation of this space; with ?refresh=1, ask PayPal for its real state first.
  app.get('/api/operations/:id', needSpace, async (req, res) => {
    const { store: own, contacts } = req.space;
    const op = await own.get(req.params.id);
    if (!op) return res.status(404).json({ errors: ['NOT_FOUND'] });
    if (req.query.refresh === '1' && paypal && op.kind === 'invoice' && OPEN_STATES.includes(op.state)) {
      try {
        const inv = await paypal.getInvoice(op.invoiceId);
        await own.update(op.id, { state: invoiceState(inv.status) });
      } catch {
        return res.json({ operation: publicOperation(op, contacts), refreshFailed: true });
      }
    } else if (req.query.refresh === '1' && paypal && op.orderId && OPEN_STATES.includes(op.state)) {
      try {
        const summary = await paypal.getOrder(op.orderId);
        // An order still waiting for approval stays as it is; anything else is the truth from PayPal.
        if (summary.captureStatus) await applySummary(op, summary);
      } catch {
        // Keep the last known state; the interface says it could not refresh.
        return res.json({ operation: publicOperation(op, contacts), refreshFailed: true });
      }
    }
    res.json({ operation: publicOperation(await own.get(op.id), contacts) });
  });

  // An unexpected error answers in the same shape as every other error.
  app.use('/api', (err, _req, res, _next) => {
    console.error('api error', err);
    res.status(500).json({ errors: ['DEFAULT'] });
  });

  if (serveStatic) {
    app.use(express.static(PUBLIC_DIR, { extensions: ['html'] }));
    app.get('/', (_req, res) => res.status(503).send('Interface not built yet: run `npm run build`.'));
  }
  return app;
}
