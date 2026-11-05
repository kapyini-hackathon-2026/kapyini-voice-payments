import express from 'express';
import { fileURLToPath } from 'node:url';
import { validateSend, emailHint } from './rules.js';
import { PayPalError, invoiceState } from './paypal.js';
import { createAgent } from './agent.js';
import { interpretWithRules } from './interpret.js';
import { createPasskeys } from './passkey.js';

// The React interface, built by `npm run build` into web/dist.
const PUBLIC_DIR = fileURLToPath(new URL('../web/dist', import.meta.url));

// States an operation can be in. Only "completed" may be announced as "done".
const OPEN_STATES = ['awaiting_approval', 'capturing', 'pending', 'unverified'];

export function stateFromSummary(s) {
  if (s.captureStatus === 'COMPLETED') return 'completed';
  if (s.captureStatus === 'PENDING') return 'pending';
  if (s.captureStatus === 'DECLINED' || s.captureStatus === 'FAILED') return 'failed';
  if (s.orderStatus === 'VOIDED') return 'cancelled';
  return 'awaiting_approval';
}

export function createApp({ config, contacts, store, paypal, interpret = interpretWithRules, aiName = null, serveStatic = true }) {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '10kb' }));

  const publicContact = (c) => ({ id: c.id, name: c.name, hint: emailHint(c.email), aliases: c.aliases || [] });
  const publicContacts = contacts.map(publicContact);
  const passkeys = createPasskeys({ store, origins: config.origins || [config.appUrl] });

  function publicOperation(op) {
    const contact = contacts.find((c) => c.id === op.contactId);
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

  app.get('/api/config', async (_req, res) => {
    res.json({
      sandboxReady: Boolean(paypal),
      environment: config.environment,
      currencies: config.currencies,
      defaultCurrency: config.currencies[0],
      limit: (config.limitCents / 100).toFixed(2),
      contacts: publicContacts,
      canSimulateDecline: config.environment === 'sandbox',
      invoicesReady: Boolean(paypal && config.payerEmail),
      trusted: config.trusted?.name ? { name: config.trusted.name, phone: config.trusted.phone || null } : null,
      helpUrl: config.helpUrl,
      ai: aiName,
      storage: store.kind,
      passkeyRegistered: await passkeys.registered(),
    });
  });

  // The voice agent: one sentence in, the next thing to say out. It never moves money:
  // at most it prepares a request that the user must still confirm.
  const agent = createAgent({ contacts, config, store, interpret, publicContact, publicOperation, paypal, hasPasskey: () => passkeys.registered() });
  app.post('/api/agent', async (req, res) => {
    const { text, draft, lang, choiceId } = req.body ?? {};
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
  app.post('/api/send/prepare', async (req, res) => {
    const result = validateSend(req.body, {
      contacts,
      currencies: config.currencies,
      limitCents: config.limitCents,
      operations: await store.list(),
    });
    if (!result.ok) return res.status(422).json({ errors: result.errors });
    const contact = contacts.find((c) => c.id === result.request.contactId);
    const prepareId = await store.prepare(result.request);
    res.json({
      prepareId,
      summary: {
        amount: result.request.amount,
        currency: result.request.currency,
        recipient: publicContact(contact),
      },
    });
  });

  // ----- Passkeys: the phone's fingerprint / Face ID, for the voice mode -----
  app.post('/api/passkey/register/options', async (_req, res) => res.json(await passkeys.registrationOptions()));
  app.post('/api/passkey/register/verify', async (req, res) => {
    const r = await passkeys.verifyRegistration(req.body?.response);
    res.status(r.ok ? 200 : 400).json(r.ok ? { ok: true } : { errors: [r.error] });
  });
  app.post('/api/passkey/reset', async (_req, res) => { await passkeys.reset(); res.json({ ok: true }); });
  // A challenge for one prepared payment, so the fingerprint confirms that payment and nothing else.
  app.post('/api/passkey/confirm/options', async (req, res) => {
    const prepared = await store.peekPrepared(String(req.body?.prepareId || ''));
    if (!prepared) return res.status(410).json({ errors: ['CONFIRMATION_EXPIRED'] });
    res.json(await passkeys.confirmationOptions(prepared.id));
  });

  // Step 2 — the user said "I confirm": create the PayPal order and hand back the approval link.
  app.post('/api/send/confirm', async (req, res) => {
    if (!paypal) return res.status(503).json({ errors: ['SANDBOX_NOT_CONFIGURED'] });
    const pending = await store.peekPrepared(String(req.body?.prepareId || ''));
    if (!pending) return res.status(410).json({ errors: ['CONFIRMATION_EXPIRED'] });
    // A request prepared by voice, on a device with a passkey, needs the fingerprint for THIS payment.
    if (pending.channel === 'voice' && (await passkeys.registered())) {
      const ok = await passkeys.verifyConfirmation(pending, req.body?.passkey);
      if (!ok) return res.status(403).json({ errors: ['PASSKEY_REQUIRED'] });
    }
    const prepared = await store.takePrepared(pending.id);
    if (!prepared) return res.status(410).json({ errors: ['CONFIRMATION_EXPIRED'] });
    const contact = contacts.find((c) => c.id === prepared.contactId);

    const op = await store.createOperation({
      kind: 'send',
      state: 'awaiting_approval',
      contactId: contact.id,
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

  // ----- Payment requests (PayPal Invoicing v2) sent to the user's Sandbox account -----
  app.get('/api/invoices', async (_req, res) => {
    if (!paypal || !config.payerEmail) return res.status(503).json({ errors: ['INVOICES_NOT_CONFIGURED'] });
    try {
      res.json({ invoices: await paypal.listOpenInvoices({ recipientEmail: config.payerEmail }) });
    } catch (err) {
      res.status(502).json({ errors: [err.issue || 'INVOICES_UNREACHABLE'] });
    }
  });

  // The "Pay" button for sighted users: same journal entry as the voice path, then PayPal's own page.
  app.post('/api/invoices/:id/pay', async (req, res) => {
    if (!paypal || !config.payerEmail) return res.status(503).json({ errors: ['INVOICES_NOT_CONFIGURED'] });
    let inv;
    try {
      inv = await paypal.getInvoice(req.params.id);
    } catch (err) {
      return res.status(502).json({ errors: [err.issue || 'INVOICES_UNREACHABLE'] });
    }
    if (!['SENT', 'UNPAID', 'PARTIALLY_PAID'].includes(inv.status) || !inv.payUrl) return res.status(409).json({ errors: ['INVOICE_NOT_PAYABLE'] });
    const op = await store.createOperation({ kind: 'invoice', state: 'awaiting_approval', invoiceId: inv.id, merchant: inv.merchant, amount: inv.amount, currency: inv.currency });
    res.json({ operationId: op.id, payUrl: inv.payUrl });
  });

  app.get('/api/operations', async (_req, res) => {
    res.json({ operations: (await store.list()).map(publicOperation) });
  });

  // Read one operation; with ?refresh=1, ask PayPal for its real state first.
  app.get('/api/operations/:id', async (req, res) => {
    const op = await store.get(req.params.id);
    if (!op) return res.status(404).json({ errors: ['NOT_FOUND'] });
    if (req.query.refresh === '1' && paypal && op.kind === 'invoice' && OPEN_STATES.includes(op.state)) {
      try {
        const inv = await paypal.getInvoice(op.invoiceId);
        await store.update(op.id, { state: invoiceState(inv.status) });
      } catch {
        return res.json({ operation: publicOperation(op), refreshFailed: true });
      }
    } else if (req.query.refresh === '1' && paypal && op.orderId && OPEN_STATES.includes(op.state)) {
      try {
        const summary = await paypal.getOrder(op.orderId);
        // An order still waiting for approval stays as it is; anything else is the truth from PayPal.
        if (summary.captureStatus) await applySummary(op, summary);
      } catch {
        // Keep the last known state; the interface says it could not refresh.
        return res.json({ operation: publicOperation(op), refreshFailed: true });
      }
    }
    res.json({ operation: publicOperation(await store.get(op.id)) });
  });

  if (serveStatic) {
    app.use(express.static(PUBLIC_DIR, { extensions: ['html'] }));
    app.get('/', (_req, res) => res.status(503).send('Interface not built yet: run `npm run build`.'));
  }
  return app;
}
