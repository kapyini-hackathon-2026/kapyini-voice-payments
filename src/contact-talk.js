// Managing contacts by voice: "ajoute un contact", "change l'adresse de mon frère",
// "supprime Amine", "quels sont mes contacts ?".
//
// Same principles as for money: one question at a time, a read-back before anything is saved,
// and decisions made by this code (no AI). A contact decides where money goes, so when the
// space has a fingerprint, a change made by voice is saved only after the fingerprint
// (someone else talking to the phone must not be able to swap an address).
import { resolveContacts } from './contacts.js';
import { cleanEmail } from './accounts.js';
import { isYes, isNo, parseOrdinal, plain } from './interpret.js';

export const CONTACT_STAGES = ['ct_name', 'ct_alias', 'ct_email', 'ct_review', 'ct_pick', 'ct_field', 'ct_remove_confirm'];
const OPS = ['add', 'edit', 'remove'];

// ----- what the user wants to do with their contacts (deterministic, checked before the AI) -----
const ADD = /\b(ajout\w*|rajout\w*|nouveau contact|nouvelle personne|cree[rz]? (un |le )?contact|creer (un |le )?contact|enregistre[rz]? (un |le )?(nouveau )?contact|add\w*|new contact)\b/;
const REMOVE = /\b(supprim\w*|efface\w*|delete\w*|remove\w*)\b|\b(retire\w*|enleve\w*)\b.*\bcontacts?\b/;
const EDIT = /\b(modifi\w*|renomm\w*|corrig\w*|edit\w*|rename\w*|update)\b|\b(change\w*|mets? a jour)\b.*\b(nom|surnom|adresse|e ?mail|mail|contact|name|nickname|address)\b/;
const LIST = /\b(quels? sont|qui sont|liste|lis|donne|dis|read|list|what are|who are)\b.*\bcontacts?\b|^(mes |my )?contacts?$/;

/** @returns 'add' | 'edit' | 'remove' | 'list' | null */
export function detectContactAction(text) {
  const s = plain(text);
  const aboutContacts = /\bcontacts?\b|\bcarnet\b/.test(s);
  if (REMOVE.test(s) && (aboutContacts || !/\b(paiement|envoi|virement|operation)\b/.test(s))) return 'remove';
  if (ADD.test(s) && (aboutContacts || /^(ajoute|ajouter|ajoutez|add)\s+\S+/.test(s))) return 'add';
  if (EDIT.test(s) && !/\b(montant|somme|amount|personne|destinataire)\b/.test(s)) return 'edit';
  if (LIST.test(s)) return 'list';
  return null;
}

/** Which field the user names: "le nom", "le surnom", "l'adresse". */
export function detectField(text) {
  const s = plain(text);
  if (/\b(surnoms?|pseudo|alias|nickname)\b/.test(s)) return 'aliases';
  if (/\b(adresse|e ?mail|mail|courriel|address)\b/.test(s)) return 'email';
  if (/\b(nom|prenom|name|renomm\w*|rename\w*)\b/.test(s)) return 'name';
  return null;
}

// ----- reading what was said -----
// "Il s'appelle fatou diallo" → "Fatou Diallo". The original spelling (accents) is kept.
export function spokenName(text) {
  const n = String(text ?? '')
    .replace(/^\s*(il s'?appelle|elle s'?appelle|il s’appelle|elle s’appelle|son nom (est|c'?est)|le nom (est|c'?est)|c'?est|c’est|ajoute[rz]?|his name is|her name is|the name is|it'?s|call (him|her))\s+/i, '')
    .replace(/[.!?;:"«»]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 60);
  return n.split(' ').filter(Boolean).map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}

// "Ajoute Fatou Diallo à mes contacts" → "Fatou Diallo"; "ajoute un contact" → "".
export function nameInAddSentence(text) {
  const rest = String(text ?? '')
    .replace(/\b(ajoute[rz]?|rajoute[rz]?|enregistre[rz]?|cr[ée]e[rz]?|add|save|please|s'?il (te|vous) pla[iî]t|stp|svp)\b/gi, ' ')
    .replace(/\b(un |une |le |la |a |the )?(nouveau |nouvelle |new )?(contact|personne|person)s?\b/gi, ' ')
    .replace(/(?:^|\s)(à|a|dans|to|in|comme|as)\s+(mes|my|ma|mon)?\s*(contacts?|carnet|liste|list)?(?=\s|$)/gi, ' ')
    .replace(/\b(mes|my)\b/gi, ' ')
    .replace(/[.!?,]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return rest.split(' ').length <= 4 ? spokenName(rest) : '';
}

// "mon frère", "son surnom c'est tata" → "mon frère", "tata". "non", "aucun" → null (no nickname).
export function spokenAlias(text) {
  const s = plain(text);
  if (/^(non|no|nope|aucun|aucune|pas de surnom|sans surnom|pas besoin|rien|none|no nickname|non merci|no thanks)$/.test(s)) return null;
  return String(text ?? '')
    .replace(/^\s*(son surnom (est|c'?est)|le surnom (est|c'?est)|surnom|appelle[- ](le|la)|c'?est|c’est|his nickname is|her nickname is|nickname|call (him|her))\s*:?\s+/i, '')
    .replace(/[.!?;:"«»]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
    .slice(0, 40);
}

// "fatou arobase personal point example point com" → "fatou@personal.example.com", or null.
export function parseSpokenEmail(text) {
  let s = String(text ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[’']/g, ' ');
  s = s.replace(/^\s*(c est|son adresse (e ?mail )?(est|c est)|l adresse (est|c est)|adresse|e ?mail|mail|it s|the address is|address)\s*:?\s*/, '');
  s = s
    .replace(/\s*\b(arobase|arrobase|arobas|a commercial|at)\b\s*/g, '@')
    .replace(/\s*\b(tiret bas|underscore|under score|underline)\b\s*/g, '_')
    .replace(/\s*\b(tiret|trait d union|dash|hyphen|moins)\b\s*/g, '-')
    .replace(/\s*\b(point|dot)\b\s*/g, '.')
    .replace(/[\s,;]+/g, '')
    .replace(/\.$/, '');
  return cleanEmail(s);
}

const str = (v, max) => (typeof v === 'string' ? v.slice(0, max) : '');

/** The contact being added or changed, as sent back by the browser: every field re-checked. */
export function readContactDraft(raw) {
  if (!raw || typeof raw !== 'object') return null;
  return {
    op: OPS.includes(raw.op) ? raw.op : null,
    id: str(raw.id, 80) || null,
    name: str(raw.name, 60),
    email: str(raw.email, 254),
    aliases: Array.isArray(raw.aliases) ? raw.aliases.filter((a) => typeof a === 'string').map((a) => a.slice(0, 40)).slice(0, 5) : [],
    aliasAsked: raw.aliasAsked === true,
  };
}

/**
 * @param contacts  the user's contacts
 * @param save      async ({ op, id, name, aliases, email }) => { ok, errors?, contact? }
 * @param prepare   async (change) => prepareId   (keeps a change waiting for the fingerprint)
 * @param hasPasskey async () => boolean
 * @param reply     the agent's reply builder
 */
export function createContactTalk({ contacts, save, prepare, hasPasskey, reply }) {
  const listOf = (list = contacts) => list.slice(0, 4);
  const choicesOf = (list) => listOf(list).map((c, i) => ({ id: c.id, label: c.name, say: c.name, n: i + 1 }));
  const yesNo = [{ label: 'reviewYes', say: 'oui', localized: true, n: 1, kind: 'yes' }, { label: 'cancel', say: 'annule', localized: true, n: 2 }];
  const at = (ct, stage, expecting, extra = {}) => ({ draft: { stage, expecting, ct, ...extra } });

  const askName = (ct, params = {}) => reply('CT_ASK_NAME', { ...at(ct, 'ct_name', 'name'), params: { op: ct.op, current: ct.op === 'edit' ? ct.name : null, ...params } });
  const askAlias = (ct, params = {}) => reply('CT_ASK_ALIAS', {
    ...at(ct, 'ct_alias', 'alias'), params: { op: ct.op, name: ct.name, current: ct.aliases, ...params },
    choices: [{ label: 'noNickname', say: 'aucun', localized: true, n: 1 }],
  });
  const askEmail = (ct, params = {}) => reply('CT_ASK_EMAIL', {
    ...at(ct, 'ct_email', 'email'), params: { op: ct.op, name: ct.name, current: ct.op === 'edit' ? ct.email : null, ...params },
    choices: [{ label: 'typeEmail', localized: true, typing: true, n: 1 }],
  });
  const review = (ct, params = {}) => reply('CT_REVIEW', {
    ...at(ct, 'ct_review', 'yesno'), params: { op: ct.op, contact: { name: ct.name, aliases: ct.aliases, email: ct.email }, ...params },
    choices: [...yesNo.slice(0, 1), { label: 'fixContact', say: 'non', localized: true, n: 2 }, { label: 'cancel', say: 'annule', localized: true, n: 3 }],
  });
  const askField = (ct) => reply('CT_FIELD', {
    ...at(ct, 'ct_field', 'field'), params: { name: ct.name },
    choices: [{ label: 'fieldName', say: 'le nom', localized: true, n: 1 }, { label: 'fieldAlias', say: 'le surnom', localized: true, n: 2 }, { label: 'fieldEmail', say: 'l’adresse', localized: true, n: 3 }],
  });
  const pick = (op, list = contacts, params = {}) => {
    if (!contacts.length) return reply('CT_NONE');
    const shown = listOf(list);
    return reply('CT_PICK', {
      draft: { stage: 'ct_pick', expecting: 'contact', ct: { op }, options: shown.map((c) => c.id) },
      params: { op, names: shown.map((c) => c.name), ...params }, choices: choicesOf(shown),
    });
  };
  const fromContact = (op, c) => ({ op, id: c.id, name: c.name, aliases: c.aliases || [], email: c.email, aliasAsked: true });

  // The next question for a contact being added: name, then nickname, then address.
  function nextForAdd(ct) {
    if (!ct.name) return askName(ct);
    if (!ct.aliasAsked) return askAlias(ct);
    if (!ct.email) return askEmail(ct);
    return review(ct);
  }
  // After a change to one field: a new contact continues its questions; an edit is read back.
  const after = (ct) => (ct.op === 'add' ? nextForAdd(ct) : review(ct));

  async function commit(ct) {
    if (await hasPasskey()) {
      const prepareId = await prepare({ kind: 'contact', change: ct });
      return reply('CT_USE_PASSKEY', { draft: { stage: 'ct_review', expecting: 'yesno', ct }, prepareId, params: { op: ct.op, name: ct.name } });
    }
    return apply(ct);
  }

  // Saves the change; on a refused field, asks that field again with the reason.
  async function apply(ct) {
    const r = await save(ct);
    if (r.ok) {
      const code = ct.op === 'remove' ? 'CT_REMOVED' : 'CT_SAVED';
      return reply(code, { params: { op: ct.op, name: r.contact?.name || ct.name }, contactsChanged: true });
    }
    const errors = r.errors || ['DEFAULT'];
    if (errors.includes('CONTACT_NAME_MISSING')) return askName({ ...ct, name: '' }, { errors });
    if (errors.some((e) => e.startsWith('CONTACT_EMAIL'))) return askEmail({ ...ct, email: '' }, { errors });
    if (errors.includes('CONTACT_ALIAS_TAKEN')) return askAlias({ ...ct, aliases: [] }, { errors });
    return reply('CT_FAILED', { params: { errors } });
  }

  /** A new request about contacts, from the first sentence. */
  function start(action, said, intentName = '') {
    if (action === 'list') return reply(contacts.length ? 'CT_LIST' : 'CT_NONE', { params: { names: contacts.map((c) => c.name) } });
    if (action === 'add') {
      const name = spokenName(intentName) || nameInAddSentence(said);
      return nextForAdd({ op: 'add', id: null, name, aliases: [], email: '', aliasAsked: false });
    }
    // edit / remove: who? The name may be in the sentence ("supprime Amine", "change l'adresse de mon frère").
    const found = resolveContacts(intentName || said, contacts);
    if (found.length !== 1) return pick(action, found.length > 1 ? found : contacts);
    return chosen(action, found[0], detectField(said));
  }

  function chosen(op, contact, field = null) {
    if (op === 'remove') {
      return reply('CT_REMOVE_CONFIRM', { ...at(fromContact('remove', contact), 'ct_remove_confirm', 'yesno'), params: { name: contact.name }, choices: yesNo });
    }
    const ct = fromContact('edit', contact);
    if (field === 'name') return askName(ct);
    if (field === 'aliases') return askAlias(ct);
    if (field === 'email') return askEmail(ct);
    return askField(ct);
  }

  /** One answer in the middle of a contact conversation. */
  async function handle(stage, ct, said, { options = [], choiceId = null } = {}) {
    if (stage === 'ct_pick') {
      const op = ct?.op || 'edit';
      const ordinal = parseOrdinal(said);
      const byNumber = ordinal ? contacts.find((c) => c.id === options[ordinal - 1]) : null;
      const byChoice = choiceId ? contacts.find((c) => c.id === choiceId) : null;
      const found = byNumber || byChoice ? [byNumber || byChoice] : resolveContacts(said, contacts);
      if (found.length === 1) return chosen(op, found[0], detectField(said));
      return pick(op, found.length > 1 ? found : contacts, { again: true });
    }
    if (!ct?.op) return reply('NOT_UNDERSTOOD');
    // Editing or removing: the contact must still exist.
    if (ct.op !== 'add' && !contacts.some((c) => c.id === ct.id)) return reply('CT_GONE');

    switch (stage) {
      case 'ct_name': {
        const name = spokenName(said);
        if (!name) return askName(ct, { again: true });
        return after({ ...ct, name });
      }
      case 'ct_alias': {
        const alias = spokenAlias(said);
        if (alias === '') return askAlias(ct, { again: true });
        return after({ ...ct, aliases: alias ? [alias] : [], aliasAsked: true });
      }
      case 'ct_email': {
        const email = parseSpokenEmail(said);
        if (!email) return askEmail(ct, { heard: said });
        return after({ ...ct, email });
      }
      case 'ct_field': {
        const field = detectField(said) || [null, 'name', 'aliases', 'email'][parseOrdinal(said) || 0];
        if (field === 'name') return askName(ct);
        if (field === 'aliases') return askAlias(ct);
        if (field === 'email') return askEmail(ct);
        return askField(ct);
      }
      case 'ct_review': {
        if (isYes(said)) return commit(ct);
        // "non": what should be corrected?
        if (isNo(said)) return askField(ct);
        const field = detectField(said);
        if (field) return handle('ct_field', ct, said);
        return review(ct, { again: true });
      }
      case 'ct_remove_confirm': {
        if (isYes(said)) return commit(ct);
        return reply('CT_CANCELLED');
      }
      default:
        return reply('NOT_UNDERSTOOD');
    }
  }

  return { start, handle, apply };
}
