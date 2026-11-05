// First launch, led by voice (team design, screens 1–2):
//   touch to start → "Shall I speak every time?" (yes = voice mode, no = classic mode, silent)
//   → "What should I call you?" → turn on the fingerprint (a real passkey, not a voiceprint).
// Browsers only let a page speak after a touch, hence the first "touch to start".
import { useEffect, useRef, useState } from 'react';
import { useKapyini } from '../context.js';
import { VOICE } from '../lib/voice-strings.js';
import { canListen, earcon, listenOnce, speak } from '../voice/speech.js';
import { passkeyAvailable, registerPasskey } from '../lib/passkey.js';
import { VoiceHeader, VoiceOrb } from '../components/voice-ui.jsx';

const plain = (s) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();
const isYes = (s) => /^(oui|ouais|yes|yeah|ok|d accord|daccord|volontiers|bien sur)\b/.test(plain(s).replace(/'/g, ' '));
const isNo = (s) => /^(non|no|nope|pas besoin|jamais)\b/.test(plain(s));
const cleanName = (s) => {
  const n = s.replace(/^(je m'?appelle|je m appelle|appelle[- ]moi|c'?est|moi c'?est|my name is|call me|it's|i'm)\s+/i, '').replace(/[.!?]/g, '').trim().split(/\s+/).slice(0, 2).join(' ');
  return n ? n.charAt(0).toUpperCase() + n.slice(1) : '';
};

export default function Welcome() {
  const { lang, setLang, rate, output, setOutput, say, setMode, setUserName, setFlow, config, setConfig } = useKapyini();
  const v = VOICE[lang].onboard;
  const [step, setStep] = useState('start'); // start | mode | name | passkey
  const [line, setLine] = useState('');
  const [heard, setHeard] = useState('');
  const [orb, setOrb] = useState('idle');
  const [busy, setBusy] = useState(false);
  const alive = useRef(true);
  const h1 = useRef();
  useEffect(() => { document.title = 'Kapyiŋi'; h1.current?.focus(); return () => { alive.current = false; }; }, []);
  useEffect(() => { h1.current?.focus(); }, [step]);

  // Before a mode exists, Kapyiŋi speaks with the browser voice, or through the screen reader if asked.
  async function talk(text) {
    setLine(text);
    setOrb('speaking');
    if (output === 'screenreader') await say(text); else { say(text); await speak(text, lang, rate); }
    if (alive.current) setOrb('idle');
  }
  async function hear() {
    if (!canListen || !alive.current) return '';
    earcon.listen();
    setOrb('listening');
    let text = '';
    try { text = await listenOnce({ lang, onInterim: setHeard }).promise; } catch { /* buttons remain */ }
    earcon.stop();
    if (alive.current) setOrb('idle');
    if (text) setHeard(text);
    return text;
  }

  async function start() {
    setStep('mode');
    await talk(v.askMode);
    for (let i = 0; i < 2 && alive.current; i++) {
      const a = await hear();
      if (isYes(a)) return chooseVoice();
      if (isNo(a)) return chooseClassic();
      if (i === 0 && alive.current) await talk(v.askModeShort);
    }
  }

  async function chooseClassic() {
    alive.current = false;
    await talk(v.classicChosen);
    setMode('classic');
    window.location.hash = '#home';
  }

  async function chooseVoice() {
    setStep('name');
    setHeard('');
    await talk(v.askName);
    const a = await hear();
    const name = cleanName(a);
    if (name) { setUserName(name); await talk(v.nameSaved(name)); }
    askPasskey(name);
  }

  async function askPasskey(name) {
    setStep('passkey');
    setHeard('');
    if (!(await passkeyAvailable())) { await talk(v.passkeyNone); return finish(name); }
    await talk(v.askPasskey);
  }

  async function enablePasskey() {
    if (busy) return;
    setBusy(true);
    setOrb('passkey');
    const r = await registerPasskey();
    setBusy(false);
    if (r.ok) { setConfig({ ...config, passkeyRegistered: true }); setOrb('done'); await talk(v.passkeyDone); }
    else { setOrb('idle'); await talk(v.passkeyFailed); }
    finish();
  }

  function finish() {
    alive.current = false;
    setFlow((f) => ({ ...f, justOnboarded: true }));
    setMode('voice');
    window.location.hash = '#home';
  }

  const btnMain = 'flex min-h-16 w-full flex-col items-start justify-center rounded-2xl px-5 py-3 text-left text-lg font-bold';

  return (
    <div className="voice-theme flex flex-col">
      <VoiceHeader pill={step === 'start' ? null : step === 'passkey' ? VOICE[lang].settings.passkeyLabel : VOICE[lang].pills.voice} />
      <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col items-center px-5 pb-12 text-center">
        <h1 ref={h1} tabIndex={-1} className="sr-only">{step === 'start' ? 'Kapyiŋi' : line}</h1>
        <div className="mt-6 sm:mt-12">
          <VoiceOrb
            state={orb}
            label={step === 'start' ? v.start : step === 'passkey' ? v.passkeyButton : VOICE[lang].voiceButton}
            onClick={step === 'start' ? start : step === 'passkey' ? enablePasskey : undefined}
            disabled={step !== 'start' && step !== 'passkey'}
          />
        </div>

        {step === 'start' ? (
          <>
            <p className="mt-14 text-3xl font-bold tracking-tight sm:text-4xl">{v.start}</p>
            <p className="mt-2 text-lg text-slate">{v.startHint}</p>
            <div className="mt-10 flex flex-wrap justify-center gap-3">
              <button type="button" className="min-h-12 rounded-full border border-line px-5 font-bold" onClick={() => { setOutput('screenreader'); start(); }}>{v.srLink}</button>
              <button type="button" className="min-h-12 rounded-full border border-line px-5 font-bold" lang={lang === 'fr' ? 'en' : 'fr'} onClick={() => setLang(lang === 'fr' ? 'en' : 'fr')}>{lang === 'fr' ? 'English' : 'Français'}</button>
            </div>
          </>
        ) : (
          <>
            <p className="mt-14 text-sm text-slate">Kapyiŋi</p>
            <p className="mt-2 max-w-2xl text-2xl font-bold leading-snug sm:text-3xl" aria-hidden="true">{line ? `“${line}”` : ''}</p>
            {heard && <p className="mt-6 text-xl font-bold text-cyan"><span className="mr-2 text-sm font-normal text-slate">{lang === 'fr' ? 'Vous' : 'You'}</span>“{heard}”</p>}
            <div className="mt-10 grid w-full max-w-md gap-3">
              {step === 'mode' && (
                <>
                  <button type="button" className={`${btnMain} bg-[#0070e0] text-white`} onClick={chooseVoice}><span>{v.yesVoice}</span><span className="text-base font-normal opacity-85">{v.yesVoiceHint}</span></button>
                  <button type="button" className={`${btnMain} border-2 border-line`} onClick={chooseClassic}><span>{v.noClassic}</span><span className="text-base font-normal text-slate">{v.noClassicHint}</span></button>
                </>
              )}
              {step === 'name' && <button type="button" className={`${btnMain} items-center border-2 border-line`} onClick={() => { alive.current = true; askPasskey(''); }}>{v.skip}</button>}
              {step === 'passkey' && (
                <>
                  <button type="button" disabled={busy} className={`${btnMain} items-center bg-[#0070e0] text-white`} onClick={enablePasskey}>{v.passkeyButton}</button>
                  <button type="button" className={`${btnMain} items-center border-2 border-line`} onClick={() => finish()}>{v.passkeyLater}</button>
                </>
              )}
            </div>
          </>
        )}
      </main>
    </div>
  );
}
