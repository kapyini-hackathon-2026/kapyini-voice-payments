import { useState } from 'react';
import { useKapyini } from '../context.js';
import { Page } from '../components/ui.jsx';
import { readSession, writeSession } from '../storage.js';
import { VOICE } from '../lib/voice-strings.js';
import { api } from '../lib/format.js';
import { passkeyAvailable, registerPasskey } from '../lib/passkey.js';
import { useEffect } from 'react';

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

export default function Settings() {
  const { t, lang, setLang, output, setOutput, rate, setRate, config, setConfig, mode, setMode, userName, setUserName } = useKapyini();
  const v = VOICE[lang];
  const [canPasskey, setCanPasskey] = useState(false);
  const [note, setNote] = useState('');
  useEffect(() => { passkeyAvailable().then(setCanPasskey); }, []);
  async function enable() {
    const r = await registerPasskey();
    if (r.ok) setConfig({ ...config, passkeyRegistered: true });
    setNote(r.ok ? v.onboard.passkeyDone : v.onboard.passkeyFailed);
  }
  async function remove() {
    await api('/api/passkey/reset', { body: {} });
    setConfig({ ...config, passkeyRegistered: false });
    setNote('');
  }
  const [simulate, setSimulate] = useState(readSession('kapyini-simulate') === '1');
  return (
    <Page title={t.settingsTitle} back={{ href: '#home', label: t.back }}>
      <Choice legend={v.settings.modeLabel} name="mode" value={mode} onChange={setMode} options={[['voice', v.toVoice], ['classic', v.toClassic]]} />
      <Choice legend={t.language} name="lang" value={lang} onChange={setLang} options={[['fr', 'Français'], ['en', 'English']]} />
      <Choice legend={t.outputLabel} name="output" value={output} onChange={setOutput} options={[['screenreader', t.outputScreenReader], ['voice', t.outputVoice]]} />
      <Choice legend={t.rateLabel} name="rate" value={rate} onChange={setRate} options={Object.entries(t.rates)} />
      <div className="mb-8">
        <label htmlFor="name" className="mb-2 block text-lg font-bold">{v.settings.nameLabel}</label>
        <input id="name" value={userName} onChange={(e) => setUserName(e.target.value)} autoComplete="given-name"
          className="min-h-14 w-full max-w-sm rounded-2xl border-2 border-line bg-paper px-4 text-lg text-text" />
      </div>
      <div className="mb-8">
        <h2 className="mb-2 text-lg font-bold">{v.settings.passkeyLabel}</h2>
        <p className="mb-3 text-slate">{config.passkeyRegistered ? v.settings.passkeyOn : v.settings.passkeyOff}</p>
        {config.passkeyRegistered
          ? <button type="button" onClick={remove} className="min-h-12 rounded-2xl border-2 border-line px-5 font-bold">{v.settings.passkeyReset}</button>
          : canPasskey && <button type="button" onClick={enable} className="min-h-12 rounded-2xl bg-[#0070e0] px-5 font-bold text-white">{v.settings.passkeyEnable}</button>}
        {note && <p role="status" className="mt-3">{note}</p>}
      </div>
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
