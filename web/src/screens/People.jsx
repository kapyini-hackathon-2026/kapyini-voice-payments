// "My contacts": the user's own list, to add, edit or remove people.
// A new space starts with a copy of the demo contacts; changes here touch this space only.
// Each address must be a PayPal Sandbox account, or the money has nowhere to go.
import { useEffect, useRef, useState } from 'react';
import { useKapyini } from '../context.js';
import { Avatar, Page, btn } from '../components/ui.jsx';
import { VOICE } from '../lib/voice-strings.js';
import { api } from '../lib/format.js';

const field = 'min-h-14 w-full rounded-2xl border-2 border-line bg-paper px-4 text-lg text-text';
const smallBtn = 'min-h-12 rounded-2xl border-2 border-line px-4 font-bold';

function ContactForm({ initial, onSaved, onCancel }) {
  const { lang } = useKapyini();
  const p = VOICE[lang].people;
  const [name, setName] = useState(initial?.name || '');
  const [aliases, setAliases] = useState((initial?.aliases || []).join(', '));
  const [email, setEmail] = useState(initial?.email || '');
  const [errors, setErrors] = useState([]);
  const [busy, setBusy] = useState(false);
  const first = useRef();
  const errorBox = useRef();
  useEffect(() => { first.current?.focus(); }, []);

  async function submit(e) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    const body = { name, aliases, email };
    const r = initial
      ? await api(`/api/contacts/${encodeURIComponent(initial.id)}`, { method: 'PATCH', body })
      : await api('/api/contacts', { body });
    setBusy(false);
    if (!r.ok) {
      setErrors(r.errors?.length ? r.errors : ['DEFAULT']);
      setTimeout(() => errorBox.current?.focus(), 0);
      return;
    }
    onSaved(r.contact, initial ? p.updated(r.contact.name) : p.added(r.contact.name));
  }

  const has = (code) => errors.includes(code);
  const nameErr = has('CONTACT_NAME_MISSING');
  const emailErr = has('CONTACT_EMAIL_INVALID') || has('CONTACT_EMAIL_TAKEN');
  const aliasErr = has('CONTACT_ALIAS_TAKEN');
  const formId = initial ? `edit-${initial.id}` : 'new';

  return (
    <form onSubmit={submit} noValidate className="grid gap-5 rounded-3xl border-2 border-text bg-paper p-5">
      <h2 className="text-xl font-bold">{initial ? p.editTitle(initial.name) : p.add}</h2>
      {errors.length > 0 && (
        <div ref={errorBox} tabIndex={-1} role="alert" className="rounded-2xl border-l-8 border-stop bg-stop-soft px-4 py-3 font-bold">
          {errors.map((code) => <p key={code}>{p.errors[code] || p.errors.DEFAULT}</p>)}
        </div>
      )}
      <div>
        <label htmlFor={`${formId}-name`} className="mb-2 block text-lg font-bold">{p.name}</label>
        <input ref={first} id={`${formId}-name`} value={name} onChange={(e) => setName(e.target.value)} maxLength={60} autoComplete="off" required aria-invalid={nameErr} className={field} />
      </div>
      <div>
        <label htmlFor={`${formId}-aliases`} className="mb-1 block text-lg font-bold">{p.aliases}</label>
        <p id={`${formId}-aliases-hint`} className="mb-2 text-slate">{p.aliasesHint}</p>
        <input id={`${formId}-aliases`} value={aliases} onChange={(e) => setAliases(e.target.value)} autoComplete="off" aria-describedby={`${formId}-aliases-hint`} aria-invalid={aliasErr} className={field} />
      </div>
      <div>
        <label htmlFor={`${formId}-email`} className="mb-1 block text-lg font-bold">{p.email}</label>
        <p id={`${formId}-email-hint`} className="mb-2 text-slate">{p.emailHint}</p>
        <input id={`${formId}-email`} type="email" inputMode="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="off" required
          aria-describedby={`${formId}-email-hint`} aria-invalid={emailErr} className={field} />
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <button type="submit" disabled={busy} className={btn.primary}>{p.save}</button>
        <button type="button" onClick={onCancel} className={btn.quiet}>{p.cancel}</button>
      </div>
    </form>
  );
}

export default function People() {
  const { t, lang, refreshConfig, say } = useKapyini();
  const p = VOICE[lang].people;
  const [list, setList] = useState(null);
  const [editing, setEditing] = useState(null); // null | 'new' | contact id
  const [removing, setRemoving] = useState(null);
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');

  async function load() {
    const r = await api('/api/contacts');
    if (r.ok) setList(r.contacts); else setError(p.errors[r.errors?.[0]] || p.errors.DEFAULT);
  }
  useEffect(() => { load(); }, []);

  async function done(message) {
    setEditing(null);
    setRemoving(null);
    setStatus(message);
    say(message);
    await Promise.all([load(), refreshConfig()]); // the agent and the send screen use the new list
  }
  async function remove(contact) {
    const r = await api(`/api/contacts/${encodeURIComponent(contact.id)}`, { method: 'DELETE' });
    if (!r.ok) { setError(p.errors[r.errors?.[0]] || p.errors.DEFAULT); return; }
    done(p.removed(contact.name));
  }

  return (
    <Page title={p.title} back={{ href: '#settings', label: t.back }}>
      <p className="mb-6 text-lg">{p.intro}</p>
      <p role="status" className={status ? 'mb-6 rounded-2xl border-l-8 border-go bg-go-soft px-4 py-3 font-bold' : 'sr-only'}>{status}</p>
      {error && <p role="alert" className="mb-6 rounded-2xl border-l-8 border-stop bg-stop-soft px-4 py-3 font-bold">{error}</p>}

      {editing === 'new'
        ? <div className="mb-8"><ContactForm onSaved={(_c, msg) => done(msg)} onCancel={() => setEditing(null)} /></div>
        : <button type="button" onClick={() => { setStatus(''); setEditing('new'); }} className={`${btn.primary} mb-8`}>+ {p.add}</button>}

      {list && list.length === 0 && <p className="text-xl text-slate">{p.empty}</p>}
      <ul className="grid gap-3">
        {(list || []).map((ct, i) => (
          <li key={ct.id}>
            {editing === ct.id ? (
              <ContactForm initial={ct} onSaved={(_c, msg) => done(msg)} onCancel={() => setEditing(null)} />
            ) : (
              <div className="rounded-2xl border-2 border-line bg-paper px-4 py-3">
                <div className="flex items-center gap-4">
                  <Avatar name={ct.name} tone={i} />
                  <div className="min-w-0 flex-1">
                    <strong className="block text-xl">{ct.name}</strong>
                    {ct.aliases.length > 0 && <span className="block text-slate">{ct.aliases.join(', ')}</span>}
                    <span className="block break-all text-slate">{ct.email}</span>
                    {ct.demo && <span className="mt-1 inline-block rounded-full bg-mist px-2.5 py-0.5 text-sm text-slate">{p.demo}</span>}
                  </div>
                </div>
                {removing === ct.id ? (
                  <div role="group" aria-label={p.removeConfirm(ct.name)} className="mt-3 rounded-2xl border-l-8 border-stop bg-stop-soft p-3">
                    <p className="mb-3 font-bold">{p.removeConfirm(ct.name)}</p>
                    <div className="flex flex-wrap gap-3">
                      <button type="button" onClick={() => remove(ct)} className="min-h-12 rounded-2xl border-2 border-stop bg-paper px-4 font-bold text-stop">{p.removeYes}</button>
                      <button type="button" onClick={() => setRemoving(null)} className={smallBtn}>{p.cancel}</button>
                    </div>
                  </div>
                ) : (
                  <div className="mt-3 flex flex-wrap gap-3">
                    <button type="button" onClick={() => { setStatus(''); setEditing(ct.id); }} className={smallBtn} aria-label={p.editTitle(ct.name)}>{p.edit}</button>
                    <button type="button" onClick={() => setRemoving(ct.id)} className={smallBtn} aria-label={`${p.remove} ${ct.name}`}>{p.remove}</button>
                  </div>
                )}
              </div>
            )}
          </li>
        ))}
      </ul>
    </Page>
  );
}
