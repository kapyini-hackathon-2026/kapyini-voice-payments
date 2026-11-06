// Kapyiŋi spaces: one per user, each with its own contacts, journal, passkeys and settings.
//
// No e-mail and no password to type. A space is created on the first launch and kept by a
// session cookie on that device. The fingerprint (a passkey, see passkey.js) is what lets the
// user come back to it, on this device or another one.
//
// A new space starts with a copy of the demo contacts (Sandbox accounts set up by the team),
// so it can be tried at once. After that the copy is the user's own: changing it never
// touches anyone else's.
import { randomUUID, randomBytes, createHash } from 'node:crypto';

export const SESSION_DAYS = 180;
export const MAX_CONTACTS = 50;
const SESSION_MS = SESSION_DAYS * 24 * 60 * 60 * 1000;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Only a hash of the session token is stored: a copy of the database does not open any space.
const hashToken = (token) => createHash('sha256').update(token).digest('base64url');
const clean = (s, max) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, max);

export function cleanEmail(input) {
  const e = clean(input, 254).toLowerCase();
  return EMAIL.test(e) ? e : null;
}

const slug = (name) => name.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 24) || 'contact';

/**
 * Checks a contact typed by the user. `others` are the user's other contacts.
 * @returns {{ ok: true, contact } | { ok: false, errors: string[] }}
 */
export function validateContact(input, others = []) {
  const errors = [];
  const name = clean(input?.name, 60);
  if (!name) errors.push('CONTACT_NAME_MISSING');
  const email = cleanEmail(input?.email);
  if (!email) errors.push('CONTACT_EMAIL_INVALID');
  else if (others.some((c) => c.email.toLowerCase() === email)) errors.push('CONTACT_EMAIL_TAKEN');

  const raw = Array.isArray(input?.aliases) ? input.aliases : String(input?.aliases ?? '').split(',');
  const aliases = [...new Set(raw.map((a) => clean(a, 40)).filter(Boolean))].slice(0, 5);
  // A nickname names exactly one person: "mon frère" cannot be two contacts.
  const taken = new Set(others.flatMap((c) => (c.aliases || []).map((a) => a.toLowerCase())));
  if (aliases.some((a) => taken.has(a.toLowerCase()))) errors.push('CONTACT_ALIAS_TAKEN');

  if (errors.length) return { ok: false, errors };
  return { ok: true, contact: { name, email, aliases } };
}

export function createAccounts({ store, demoContacts = [], defaultPayerEmail = null }) {
  const contactsOf = async (userId) => (await store.forUser(userId).kvGet('contacts')) || [];
  const saveContacts = (userId, list) => store.forUser(userId).kvSet('contacts', list);

  const accounts = {
    async create({ name = '' } = {}) {
      const user = { id: randomUUID(), name: clean(name, 40), payerEmail: defaultPayerEmail, createdAt: Date.now() };
      await store.kvSet(`user:${user.id}`, user);
      await saveContacts(user.id, demoContacts.map((c) => ({ id: c.id, name: c.name, email: c.email, aliases: c.aliases || [], demo: true })));
      return user;
    },

    get: (id) => (id ? store.kvGet(`user:${id}`) : null),

    /** Name and PayPal Sandbox address (where payment requests are looked for). */
    async update(id, fields = {}) {
      const user = await accounts.get(id);
      if (!user) return { ok: false, errors: ['NO_ACCOUNT'] };
      if ('name' in fields) user.name = clean(fields.name, 40);
      if ('payerEmail' in fields) {
        if (fields.payerEmail === '' || fields.payerEmail === null) user.payerEmail = null;
        else {
          const e = cleanEmail(fields.payerEmail);
          if (!e) return { ok: false, errors: ['PAYER_EMAIL_INVALID'] };
          user.payerEmail = e;
        }
      }
      await store.kvSet(`user:${id}`, user);
      return { ok: true, user };
    },

    async openSession(userId) {
      const token = randomBytes(32).toString('base64url');
      await store.kvSet(`session:${hashToken(token)}`, { userId, at: Date.now() });
      return token;
    },
    async fromSession(token) {
      if (!token || token.length > 100) return null;
      const s = await store.kvGet(`session:${hashToken(token)}`);
      if (!s || Date.now() - s.at > SESSION_MS) return null;
      return accounts.get(s.userId);
    },
    async closeSession(token) {
      if (token) await store.kvDel(`session:${hashToken(token)}`);
    },

    contacts: contactsOf,

    async addContact(userId, input) {
      const list = await contactsOf(userId);
      if (list.length >= MAX_CONTACTS) return { ok: false, errors: ['CONTACT_LIMIT'] };
      const r = validateContact(input, list);
      if (!r.ok) return r;
      const contact = { id: `${slug(r.contact.name)}-${randomBytes(3).toString('hex')}`, ...r.contact };
      await saveContacts(userId, [...list, contact]);
      return { ok: true, contact };
    },

    async updateContact(userId, contactId, input) {
      const list = await contactsOf(userId);
      const current = list.find((c) => c.id === contactId);
      if (!current) return { ok: false, errors: ['UNKNOWN_CONTACT'] };
      const r = validateContact({ ...current, ...input }, list.filter((c) => c.id !== contactId));
      if (!r.ok) return r;
      const contact = { id: contactId, ...r.contact };
      await saveContacts(userId, list.map((c) => (c.id === contactId ? contact : c)));
      return { ok: true, contact };
    },

    async removeContact(userId, contactId) {
      const list = await contactsOf(userId);
      if (!list.some((c) => c.id === contactId)) return { ok: false, errors: ['UNKNOWN_CONTACT'] };
      await saveContacts(userId, list.filter((c) => c.id !== contactId));
      return { ok: true };
    },
  };
  return accounts;
}
