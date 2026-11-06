import { useEffect, useState } from 'react';
import { useKapyini } from '../context.js';
import { Page } from '../components/ui.jsx';
import { readSession, writeSession } from '../storage.js';
import { VOICE } from '../lib/voice-strings.js';
import { api } from '../lib/format.js';
import { passkeyAvailable, registerPasskey } from '../lib/passkey.js';

function Choice({ legend, name, value, options, onChange }) {
  return (
    <fieldset className="mb-8">
      <legend className="mb-3 text-lg font-bold">{legend}</legend>
      <div className="flex flex-wrap gap-3">
        {options.map(([v, label]) => (
          <label key={v} className="inline-flex min-h-14 cursor-pointer items-center gap-3 rounded-2xl border-2 border-line px-5 font-bold has-[:checked]:border-text has-[:checked]:bg-mist">
            <input type="radio" name={name} checked={value === v} onChange={() => onChange(v)} className="h-6 w-6 accent-[var(--text)]" />
            {label}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

const field = 'min-h-14 w-full max-w-sm rounded-2xl border-2 border-line bg-paper px-4 text-lg text-text';
const quietBtn = 'min-h-12 rounded-2xl border-2 border-line px-5 font-bold';
const blueBtn = 'min-h-12 rounded-2xl bg-[#0070e0] px-5 font-bold text-white';

// The user's own space: first name, PayPal Sandbox address, fingerprints, contacts, leaving.
function MySpace() {
  const { lang, config, setConfig, refreshConfig, setUserName } = useKapyini();
  const v = VOICE[lang];
  const sp = v.space;
  const errs = v.people.errors;
  const account = config.account;
  const [name, setName] = useState(account.name || '');
  const [payer, setPayer] = useState(account.payerEmail || '');
  const [note, setNote] = useState('');
  const [error, setError] = useState('');
  const [canPasskey, setCanPasskey] = useState(false);
  const [leaving, setLeaving] = useState(false);
  useEffect(() => { passkeyAvailable().then(setCanPasskey); }, []);

  async function saveName() {
    if (name.trim() === (account.name || '')) return;
    const r = await setUserName(name);
    setNote(r.ok ? sp.saved : errs[r.errors?.[0]] || errs.DEFAULT);
  }
  async function savePayer(e) {
    e.preventDefault();
    const r = await api('/api/account', { method: 'PATCH', body: { payerEmail: payer } });
    if (!r.ok) { setError(errs[r.errors?.[0]] || errs.DEFAULT); return; }
    setError('');
    setNote(sp.saved);
    await refreshConfig(); // payment requests depend on this address
  }
  async function addPasskey() {
    const r = await registerPasskey();
    setNote(r.ok ? v.onboard.passkeyDone : v.onboard.passkeyFailed);
    if (r.ok) await refreshConfig();
  }
  async function removePasskeys() {
    await api('/api/passkey/reset', { body: {} });
    setNote('');
    await refreshConfig();
  }
  async function leave() {
    await api('/api/account/logout', { body: {} });
    setConfig({ ...config, account: null, contacts: [], passkeyRegistered: false, invoicesReady: false });
    window.location.hash = '#home';
  }

  return (
    <section aria-labelledby="space-title" className="mb-10 rounded-3xl border-2 border-line p-5">
      <h2 id="space-title" className="mb-1 text-xl font-bold">{sp.title}</h2>
      <p className="mb-6 text-slate">{sp.intro}</p>

      <div className="mb-6">
        <label htmlFor="name" className="mb-2 block text-lg font-bold">{v.settings.nameLabel}</label>
        <input id="name" value={name} onChange={(e) => setName(e.target.value)} onBlur={saveName} autoComplete="given-name" maxLength={40} className={field} />
      </div>

      <form className="mb-6" onSubmit={savePayer} noValidate>
        <label htmlFor="payer" className="mb-1 block text-lg font-bold">{sp.payerLabel}</label>
        <p id="payer-hint" className="mb-2 text-slate">{sp.payerHint}</p>
        <div className="flex flex-wrap gap-3">
          <input id="payer" type="email" value={payer} onChange={(e) => setPayer(e.target.value)} autoComplete="email" inputMode="email"
            aria-describedby={`payer-hint${error ? ' payer-error' : ''}`} aria-invalid={Boolean(error)} className={field} />
          <button type="submit" className={quietBtn}>{sp.save}</button>
        </div>
        {error && <p id="payer-error" className="mt-2 font-bold text-stop">{error}</p>}
      </form>

      <div className="mb-6">
        <h3 className="mb-1 text-lg font-bold">{v.settings.passkeyLabel}</h3>
        <p className="mb-3 text-slate">{account.passkeys ? sp.passkeyCount(account.passkeys) : v.settings.passkeyOff}</p>
        <div className="flex flex-wrap gap-3">
          {canPasskey && <button type="button" onClick={addPasskey} aria-describedby="passkey-add-hint" className={blueBtn}>{account.passkeys ? sp.passkeyAdd : v.settings.passkeyEnable}</button>}
          {account.passkeys > 0 && <button type="button" onClick={removePasskeys} className={quietBtn}>{v.settings.passkeyReset}</button>}
        </div>
        {canPasskey && <p id="passkey-add-hint" className="mt-2 text-slate">{sp.passkeyAddHint}</p>}
      </div>

      <p className="mb-6"><a href="#people" className="inline-flex min-h-12 items-center font-bold text-blue">{sp.contactsLink} ›</a></p>

      {note && <p role="status" className="mb-6">{note}</p>}

      <div>
        {!leaving ? (
          <button type="button" onClick={() => setLeaving(true)} className={quietBtn}>{sp.logout}</button>
        ) : (
          <div role="group" aria-labelledby="leave-warning" className="rounded-2xl border-l-8 border-wait bg-wait-soft p-4">
            <p id="leave-warning" className="mb-3 font-bold">{account.passkeys ? sp.logoutHint : sp.logoutNoPasskey}</p>
            <div className="flex flex-wrap gap-3">
              <button type="button" onClick={leave} className="min-h-12 rounded-2xl border-2 border-stop bg-paper px-5 font-bold text-stop">{sp.logoutConfirm}</button>
              <button type="button" onClick={() => setLeaving(false)} className={quietBtn}>{v.people.cancel}</button>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}

export default function Settings() {
  const { t, lang, setLang, output, setOutput, rate, setRate, config, mode, setMode } = useKapyini();
  const v = VOICE[lang];
  const [simulate, setSimulate] = useState(readSession('kapyini-simulate') === '1');
  return (
    <Page title={t.settingsTitle} back={{ href: '#home', label: t.back }}>
      <MySpace />
      <Choice legend={v.settings.modeLabel} name="mode" value={mode} onChange={setMode} options={[['voice', v.toVoice], ['classic', v.toClassic]]} />
      <Choice legend={t.language} name="lang" value={lang} onChange={setLang} options={[['fr', 'Français'], ['en', 'English']]} />
      <Choice legend={t.outputLabel} name="output" value={output} onChange={setOutput} options={[['screenreader', t.outputScreenReader], ['voice', t.outputVoice]]} />
      <Choice legend={t.rateLabel} name="rate" value={rate} onChange={setRate} options={Object.entries(t.rates)} />
      {config.canSimulateDecline && (
        <div className="mb-8 grid grid-cols-[auto_1fr] items-center gap-x-4 gap-y-1">
          <input type="checkbox" id="simulate" aria-describedby="simulate-hint" checked={simulate} className="h-6 w-6 accent-[var(--text)]"
            onChange={(e) => { setSimulate(e.target.checked); writeSession('kapyini-simulate', e.target.checked ? '1' : '0'); }} />
          <label htmlFor="simulate" className="text-lg font-bold">{t.simulate}</label>
          <p id="simulate-hint" className="col-start-2 text-slate">{t.simulateHint}</p>
        </div>
      )}
      <h2 className="mb-2 text-xl font-bold">{t.aboutTitle}</h2>
      <p className="mb-3">{t.about}</p>
      <p className="mb-3">{t.aiNote(config.ai)}</p>
      <p className="text-slate">{t.speechNote}</p>
    </Page>
  );
}
