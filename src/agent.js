// The conversation. The interpreter (Claude or rules) only says what was heard;
// this file decides what to ask next. Money can move only through three locks:
//   1. rules   — validateSend() and the prepared request (no AI)
//   2. intent  — the user hears a read-back, says "oui", then REPEATS THE AMOUNT (compared here, no AI)
//   3. PayPal  — the user logs in and approves on PayPal's own page
//
// Stateless server: the browser sends back the `draft` it received last time, and every
// field of it is checked again here. `draft.stage` says where the conversation is.
import { resolveContacts } from './contacts.js';
import { validateSend, parseAmount } from './rules.js';
import { parseSpokenAmount } from './spoken.js';
import {
  detectCommand, isYes, isNo, isSendAnyway, saysOther, wantsChangePerson, wantsChangeAmount, hasNegation, parseOrdinal,
} from './interpret.js';

const STAGES = ['collect', 'review', 'fix', 'confirm', 'mismatch', 'duplicate', 'invoice_pick', 'invoice_review', 'invoice_confirm', 'invoice_mismatch'];
const SETTINGS = { slower: ['rate', 'slower'], faster: ['rate', 'faster'], lang_en: ['lang', 'en'], lang_fr: ['lang', 'fr'], screenreader: ['output', 'screenreader'], voice: ['output', 'voice'] };

export function createAgent({ contacts, config, store, interpret, publicContact, publicOperation, paypal = null, hasPasskey = async () => false }) {
  const knownContacts = contacts.map((c) => ({ name: c.name, nicknames: c.aliases || [] }));
  const choicesOfContacts = (list = contacts) => list.slice(0, 4).map((c, i) => ({ id: c.id, label: c.name, say: c.name, n: i + 1 }));
  const choicesOfCurrencies = () => config.currencies.map((c, i) => ({ label: c, say: c, currency: c, n: i + 1 }));

  function reply(code, { draft = {}, params = {}, choices = [], ...rest } = {}) {
    return { reply: { code, params }, draft, choices, ...rest };
  }

  function summaryOf(d) {
    const c = contacts.find((x) => x.id === d.contactId);
    const p = parseAmount(d.amount);
    return { amount: p.ok ? p.value : d.amount, currency: d.currency, recipient: { ...publicContact(c), alias: c.aliases?.[0] ?? null } };
  }

  // "Who?" always comes with the list read out and numbered, so a user who cannot spell or
  // pronounce a name exactly can answer "le deuxième".
  function askContact(d, code, params = {}, list = contacts) {
    const shown = list.slice(0, 4);
    return reply(code, {
      draft: { ...d, contactId: null, stage: 'collect', expecting: 'contact', options: shown.map((c) => c.id) },
      params: { ...params, names: shown.map((c) => c.name) }, choices: choicesOfContacts(shown),
    });
  }

  // Ask for what is missing, one question at a time; when nothing is missing, check the rules
  // and read the payment back (stage "review"). Nothing is prepared yet at this point.
  async function next(d, { corrected = false } = {}) {
    const contact = contacts.find((c) => c.id === d.contactId);
    if (!contact) return askContact(d, 'ASK_CONTACT');
    if (!d.amount) return reply('ASK_AMOUNT', { draft: { ...d, stage: 'collect', expecting: 'amount' }, params: { name: contact.name } });
    if (!d.currency) {
      if (config.currencies.length === 1) d.currency = config.currencies[0];
      else return reply('ASK_CURRENCY', { draft: { ...d, stage: 'collect', expecting: 'currency', options: config.currencies }, params: { amount: d.amount }, choices: choicesOfCurrencies() });
    }
    const result = validateSend(
      { contactId: d.contactId, amount: d.amount, currency: d.currency, allowDuplicate: d.allowDuplicate },
      { contacts, currencies: config.currencies, limitCents: config.limitCents, operations: await store.list() },
    );
    if (!result.ok) {
      if (result.errors.includes('POSSIBLE_DUPLICATE')) {
        return reply('DUPLICATE', {
          draft: { ...d, stage: 'duplicate' }, params: { summary: summaryOf(d) },
          choices: [{ label: 'sendAnyway', say: 'sendAnyway', localized: true, n: 1 }, { label: 'cancel', say: 'cancel', localized: true, n: 2 }],
        });
      }
      return reply('INVALID', { draft: { ...d, amount: null, stage: 'collect', expecting: 'amount' }, params: { errors: result.errors, name: contact.name } });
    }
    d.amount = result.request.amount;
    return reply('REVIEW', {
      draft: { ...d, stage: 'review', expecting: 'yesno' }, params: { summary: summaryOf(d), corrected },
      choices: [{ label: 'reviewYes', say: 'oui', localized: true, n: 1, kind: 'yes' }, { label: 'fixAmount', say: 'change le montant', localized: true, n: 2 }, { label: 'fixPerson', say: 'change la personne', localized: true, n: 3 }],
    });
  }

  // Put what was understood into the draft. Returns a reply when a question is needed first.
  function apply(d, intent, said) {
    if (intent.amount) {
      d.amount = intent.amount;
    } else {
      // The AI or rules may miss "trente"; the deterministic parser does not.
      // Outside a direct question, a number word counts only next to a currency ("un peu d'argent" is not 1).
      const cents = parseSpokenAmount(said);
      const answering = d.expecting === 'amount' || d.stage === 'review' || d.stage === 'fix';
      if (cents !== null && (answering || /\b(euros?|dollars?|dirhams?)\b|€|\$/.test(said.toLowerCase()))) d.amount = (cents / 100).toFixed(2);
    }
    if (intent.currency) {
      if (!config.currencies.includes(intent.currency)) {
        return reply('CURRENCY_UNSUPPORTED', {
          draft: { ...d, stage: 'collect', expecting: 'currency', options: config.currencies },
          params: { currency: intent.currency, amount: d.amount }, choices: choicesOfCurrencies(),
        });
      }
      d.currency = intent.currency;
    }
    // The name said, else any name heard anywhere in the sentence ("envoie à Jon Do vingt euros").
    let found = intent.contact_name ? resolveContacts(intent.contact_name, contacts) : [];
    if (!found.length) found = resolveContacts(said, contacts);
    const triedName = Boolean(intent.contact_name) || d.expecting === 'contact';
    if (found.length === 1) {
      d.contactId = found[0].id;
    } else if (found.length > 1) {
      d.alternatives = found.map((c) => c.id);
      return askContact(d, 'WHICH_CONTACT', {}, found);
    } else if (triedName && (!d.contactId || intent.contact_name)) {
      return askContact(d, 'CONTACT_NOT_FOUND', { heard: intent.contact_name || said });
    }
    return null;
  }

  async function prepareAndAsk(d) {
    const result = validateSend(
      { contactId: d.contactId, amount: d.amount, currency: d.currency, allowDuplicate: d.allowDuplicate },
      { contacts, currencies: config.currencies, limitCents: config.limitCents, operations: await store.list() },
    );
    if (!result.ok) return next(d);
    // channel "voice": the server will then require the fingerprint when a passkey exists.
    const prepareId = await store.prepare({ ...result.request, channel: 'voice' });
    const method = (await hasPasskey()) ? 'passkey' : 'amount';
    return reply('CONFIRM_ASK', {
      draft: { ...d, stage: 'confirm', prepareId, method, expecting: method === 'passkey' ? 'yesno' : 'amount_phrase' },
      params: { summary: summaryOf(d), method }, prepareId, summary: summaryOf(d),
      choices: [{ label: 'cancel', say: 'annule', localized: true, n: 1 }],
    });
  }

  // ---------- payment requests (invoices) ----------
  async function openInvoices() {
    if (!paypal || !config.payerEmail) return null;
    return paypal.listOpenInvoices({ recipientEmail: config.payerEmail });
  }
  const invoiceChoices = (list) => list.slice(0, 4).map((inv, i) => ({ id: inv.id, label: inv.merchant || inv.number || inv.id, say: String(i + 1), n: i + 1, invoice: inv }));

  async function startInvoices() {
    let list;
    try {
      list = await openInvoices();
    } catch {
      return reply('INVOICES_UNREACHABLE');
    }
    if (list === null) return reply('INVOICES_UNAVAILABLE');
    if (!list.length) return reply('NO_INVOICES');
    if (list.length === 1) return reviewInvoice(list[0]);
    return reply('INVOICE_PICK', { draft: { stage: 'invoice_pick', invoiceIds: list.map((i) => i.id), expecting: 'choice' }, params: { invoices: list }, choices: invoiceChoices(list) });
  }

  function reviewInvoice(inv) {
    return reply('INVOICE_REVIEW', {
      draft: { stage: 'invoice_review', invoiceId: inv.id, expecting: 'yesno' }, params: { invoice: inv },
      choices: [{ label: 'payInvoice', say: 'oui', localized: true, n: 1, kind: 'yes' }, { label: 'cancel', say: 'annule', localized: true, n: 2 }],
    });
  }

  async function freshInvoice(id) {
    try {
      const inv = await paypal.getInvoice(id);
      return ['SENT', 'UNPAID', 'PARTIALLY_PAID'].includes(inv.status) ? inv : null;
    } catch {
      return null;
    }
  }

  async function handleInvoice(d, said, cmd) {
    if (d.stage === 'invoice_pick') {
      const ids = Array.isArray(d.invoiceIds) ? d.invoiceIds : [];
      const n = parseSpokenAmount(said);
      const ordinal = /premi|first/.test(said.toLowerCase()) ? 1 : /deuxi|second/.test(said.toLowerCase()) ? 2 : /troisi|third/.test(said.toLowerCase()) ? 3 : n ? n / 100 : null;
      const id = ids.at((ordinal || 0) - 1) ?? (ids.includes(d.choiceId) ? d.choiceId : null);
      const inv = id && ordinal ? await freshInvoice(id) : null;
      if (!inv) return startInvoices();
      return reviewInvoice(inv);
    }
    const inv = await freshInvoice(d.invoiceId);
    if (!inv) return reply('INVOICE_GONE');
    if (d.stage === 'invoice_review') {
      if (isYes(said)) {
        return reply('INVOICE_CONFIRM_ASK', {
          draft: { stage: 'invoice_confirm', invoiceId: inv.id, expecting: 'amount_phrase' }, params: { invoice: inv },
          choices: [{ label: 'cancel', say: 'annule', localized: true, n: 1 }],
        });
      }
      if (isNo(said)) return reply('CANCELLED');
      if (cmd === 'repeat' || cmd === 'back') return reviewInvoice(inv);
      return { ...reviewInvoice(inv), reply: { code: 'INVOICE_REVIEW', params: { invoice: inv, again: true } } };
    }
    // invoice_confirm: the amount of the bill must be said back.
    if (isNo(said) && parseSpokenAmount(said) === null) return reply('CANCELLED');
    if (cmd === 'repeat' || cmd === 'back') return reviewInvoice(inv);
    const spoken = parseSpokenAmount(said);
    const due = Math.round(Number(inv.amount) * 100);
    if (spoken === due && !hasNegation(said)) return payInvoice(inv);
    if (spoken !== null) return reply('INVOICE_AMOUNT_MISMATCH', { draft: { stage: 'invoice_confirm', invoiceId: inv.id, expecting: 'amount_phrase' }, params: { invoice: inv, heard: (spoken / 100).toFixed(2) } });
    return reply('INVOICE_SAY_AMOUNT', { draft: { stage: 'invoice_confirm', invoiceId: inv.id, expecting: 'amount_phrase' }, params: { invoice: inv } });
  }

  async function payInvoice(inv) {
    const op = await store.createOperation({ kind: 'invoice', state: 'awaiting_approval', invoiceId: inv.id, merchant: inv.merchant, amount: inv.amount, currency: inv.currency });
    return reply('INVOICE_CONFIRMED', { params: { invoice: inv }, operationId: op.id, payUrl: inv.payUrl });
  }

  // ---------- the conversation ----------
  async function handle({ text, draft: incoming = {}, lang = 'fr', choiceId = null }) {
    const said = String(text ?? '').trim().slice(0, 300);
    if (!said) return reply('NOT_UNDERSTOOD', { draft: incoming });

    const d = {
      stage: STAGES.includes(incoming.stage) ? incoming.stage : 'collect',
      contactId: contacts.some((c) => c.id === incoming.contactId) ? incoming.contactId : null,
      amount: typeof incoming.amount === 'string' ? incoming.amount : null,
      currency: config.currencies.includes(incoming.currency) ? incoming.currency : null,
      alternatives: Array.isArray(incoming.alternatives) ? incoming.alternatives.filter((id) => contacts.some((c) => c.id === id)) : [],
      allowDuplicate: incoming.allowDuplicate === true,
      expecting: typeof incoming.expecting === 'string' ? incoming.expecting : null,
      prepareId: typeof incoming.prepareId === 'string' ? incoming.prepareId : null,
      invoiceId: typeof incoming.invoiceId === 'string' ? incoming.invoiceId : null,
      invoiceIds: Array.isArray(incoming.invoiceIds) ? incoming.invoiceIds.filter((x) => typeof x === 'string') : [],
      options: Array.isArray(incoming.options) ? incoming.options.filter((x) => typeof x === 'string').slice(0, 4) : [],
      choiceId,
    };

    // Words that work everywhere, decided without AI.
    const cmd = detectCommand(said);
    if (cmd === 'cancel') return reply('CANCELLED');
    if (cmd === 'repeat') return reply('REPEAT', { draft: incoming });
    if (cmd === 'help') return reply('HELP', { draft: incoming });
    if (cmd in SETTINGS) return reply('SETTING', { draft: incoming, params: { key: SETTINGS[cmd][0], value: SETTINGS[cmd][1] } });
    if (cmd === 'where') {
      const busy = d.contactId || d.amount || d.invoiceId;
      return reply(busy ? 'WHERE' : 'WHERE_NOTHING', { draft: incoming, params: { stage: d.stage, summary: d.contactId && d.amount && d.currency ? summaryOf(d) : null } });
    }

    if (d.stage.startsWith('invoice_')) return handleInvoice(d, said, cmd);

    // ----- 2nd lock: the amount must be said back. -----
    if (d.stage === 'confirm') {
      const prepared = d.prepareId ? await store.peekPrepared(d.prepareId) : null;
      if (!prepared) return { ...(await next(d)), reply: { code: 'EXPIRED', params: {} } };
      if (cmd === 'back') return next(d);
      const spoken = parseSpokenAmount(said);
      if (spoken === null && isNo(said)) return reply('CANCELLED');
      // With a passkey, "oui" (or the amount) hands over to the fingerprint sensor:
      // the fingerprint, checked by the server, is the confirmation. Voice alone is not.
      if (await hasPasskey()) {
        if ((isYes(said) || spoken === prepared.amountCents) && !hasNegation(said)) {
          return reply('USE_PASSKEY', { draft: { ...d, method: 'passkey' }, prepareId: d.prepareId, params: { summary: summaryOf(d) }, choices: [{ label: 'cancel', say: 'annule', localized: true, n: 1 }] });
        }
        if (spoken === null) return reply('PASSKEY_HINT', { draft: { ...d, method: 'passkey' }, params: { summary: summaryOf(d) }, choices: [{ label: 'cancel', say: 'annule', localized: true, n: 1 }] });
      }
      if (spoken === prepared.amountCents && !hasNegation(said)) {
        await store.markPrepared(d.prepareId, { voiceVerified: true });
        return reply('CONFIRMED', { draft: { stage: 'done' }, prepareId: d.prepareId, summary: summaryOf(d) });
      }
      if (spoken !== null) {
        return reply('AMOUNT_MISMATCH', {
          draft: { ...d, stage: 'mismatch', heard: (spoken / 100).toFixed(2), expecting: 'yesno' },
          params: { heard: (spoken / 100).toFixed(2), summary: summaryOf(d) },
          choices: [{ label: 'changeAmount', say: 'oui', localized: true, n: 1, kind: 'yes' }, { label: 'keepAmount', say: 'non', localized: true, n: 2 }],
        });
      }
      // "oui", "je confirme" alone, noise: never enough.
      return reply('SAY_AMOUNT', { draft: d, params: { summary: summaryOf(d) }, choices: [{ label: 'cancel', say: 'annule', localized: true, n: 1 }] });
    }

    if (d.stage === 'mismatch') {
      if (isYes(said) && typeof incoming.heard === 'string') return next({ ...d, amount: incoming.heard, prepareId: null }, { corrected: true });
      return prepareAndAsk({ ...d, prepareId: null });
    }

    if (d.stage === 'duplicate') {
      if (isSendAnyway(said) || isYes(said)) return next({ ...d, allowDuplicate: true });
      return reply('CANCELLED');
    }

    // ----- 1st read-back: "oui" only moves on. Corrections are spoken. -----
    if (d.stage === 'review' || d.stage === 'fix') {
      if (cmd === 'back') return next({ ...d, amount: null });
      if (d.stage === 'review' && isYes(said)) return prepareAndAsk(d);
      if (saysOther(said) && d.alternatives.length > 1) {
        const other = d.alternatives.find((id) => id !== d.contactId);
        return next({ ...d, contactId: other }, { corrected: true });
      }
      if (wantsChangeAmount(said) && parseSpokenAmount(said) === null) return next({ ...d, amount: null });
      if (wantsChangePerson(said) && !resolveContacts(said, contacts).length) return next({ ...d, contactId: null });
      const intent = await interpret({ text: said, lang, expecting: 'correction', knownContacts });
      const before = JSON.stringify([d.contactId, d.amount, d.currency]);
      const question = apply(d, { ...intent, action: 'send' }, said);
      if (question) return question;
      if (JSON.stringify([d.contactId, d.amount, d.currency]) !== before) return next(d, { corrected: true });
      if (isNo(said)) {
        return reply('FIX_WHAT', {
          draft: { ...d, stage: 'fix', expecting: 'fix' },
          choices: [{ label: 'fixAmount', say: 'le montant', localized: true, n: 1 }, { label: 'fixPerson', say: 'la personne', localized: true, n: 2 }],
        });
      }
      if (d.stage === 'fix' && /personne|person|destinataire/.test(said.toLowerCase())) return next({ ...d, contactId: null });
      if (d.stage === 'fix' && /montant|amount|somme/.test(said.toLowerCase())) return next({ ...d, amount: null });
      return { ...(await next(d)), reply: { code: 'REVIEW', params: { summary: summaryOf(d), again: true } } };
    }

    // ----- collecting: who, how much, which currency -----
    // "le deuxième", "numéro 1": a pick from the list Kapyiŋi just read out.
    const ordinal = parseOrdinal(said);
    if (ordinal && d.options.length && (d.expecting === 'contact' || d.expecting === 'currency')) {
      const pick = d.options.at(ordinal - 1);
      if (d.expecting === 'contact' && contacts.some((c) => c.id === pick)) return next({ ...d, contactId: pick });
      if (d.expecting === 'currency' && config.currencies.includes(pick)) return next({ ...d, currency: pick });
    }
    const intent = await interpret({ text: said, lang, expecting: d.expecting, knownContacts });
    const building = Boolean(d.contactId || d.amount || d.currency || d.expecting);
    switch (intent.action) {
      case 'balance': return reply('BALANCE_UNAVAILABLE');
      case 'help': return reply('HELP');
      case 'human':
        return reply('HUMAN_HELP', {
          params: { trusted: config.trusted?.name ?? null },
          choices: [
            ...(config.trusted?.phone ? [{ label: 'callTrusted', localized: true, href: `tel:${config.trusted.phone}`, n: 1 }] : []),
            { label: 'openHelp', localized: true, href: config.helpUrl, n: config.trusted?.phone ? 2 : 1 },
          ],
        });
      case 'invoices': return startInvoices();
      case 'activity': {
        const ops = (await store.list()).slice(0, 3).map(publicOperation);
        return reply(ops.length ? 'ACTIVITY' : 'NO_OPERATIONS', { params: { ops } });
      }
      case 'status': {
        const last = (await store.list())[0];
        return last ? reply('STATUS', { params: { operationId: last.id } }) : reply('NO_OPERATIONS');
      }
      case 'send': break;
      default:
        if (!building && parseSpokenAmount(said) === null) return reply('NOT_UNDERSTOOD');
    }
    if (choiceId && contacts.some((c) => c.id === choiceId)) {
      d.contactId = choiceId;
      if (intent.contact_name) intent.contact_name = '';
    }
    const question = apply(d, intent, said);
    return question || next(d);
  }

  return handle;
}
