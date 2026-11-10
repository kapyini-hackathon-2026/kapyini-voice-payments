// Voice mode: Kapyiŋi's stage (after the team's design). Opens only when the user chose the voice mode.
// One gesture: touch the disc to talk, or to interrupt Kapyiŋi. On a computer: Space, Esc, R.
// One loop: Kapyiŋi speaks → listens → asks the server what was understood → speaks again.
// Every spoken answer also has a big button, and everything said is written on screen.
import { useEffect, useRef, useState } from 'react';
import { useKapyini } from '../context.js';
import { STRINGS } from '../lib/i18n.js';
import { VOICE } from '../lib/voice-strings.js';
import { localCommand } from '../voice/commands.js';
import { runLocal } from '../voice/runLocal.js';
import { api } from '../lib/format.js';
import { signPayment } from '../lib/passkey.js';
import { canListen, earcon, listenOnce, stopSpeaking } from '../voice/speech.js';
import { watchForVoice, bargeInOn, isEcho } from '../voice/vad.js';
import { isBrief, FULL_AFTER } from '../voice/brevity.js';
import { btn } from '../components/ui.jsx';
import { VoiceHeader, VoiceOrb } from '../components/voice-ui.jsx';
import TransactionCard, { InvoiceCard } from '../components/TransactionCard.jsx';

const REVIEWS = ['REVIEW', 'INVOICE_REVIEW', 'INVOICE_PICK', 'FIX_WHAT', 'AMOUNT_MISMATCH', 'DUPLICATE'];
// After a reply that is not a question, Kapyiŋi keeps listening this long, then rests.
const LISTEN_WINDOW_MS = 8000;
const CONFIRMS = ['CONFIRM_ASK', 'SAY_AMOUNT', 'USE_PASSKEY', 'PASSKEY_HINT', 'CT_REVIEW', 'CT_REMOVE_CONFIRM', 'CT_USE_PASSKEY', 'INVOICE_CONFIRM_ASK', 'INVOICE_SAY_AMOUNT', 'INVOICE_AMOUNT_MISMATCH'];

export default function Agent({ arg }) {
  const kapyini = useKapyini();
  const { t, c, lang, setLang, output, setOutput, setRate, rate, config, flow, setFlow, say, go, confirmPayment, handOver, setMode, userName, refreshConfig } = kapyini;
  const v = VOICE[lang];
  const [phase, setPhase] = useState('idle'); // idle | listening | thinking | speaking | passkey | problem
  // Browsers let a page speak only after a touch on it. On a new visit Kapyiŋi waits for one touch,
  // anywhere on the screen. Coming back to this screen during the same visit, it is already awake.
  const [awake, setAwake] = useState(Boolean(flow.justOnboarded || flow.greetNow || flow.pendingText || arg === 'listen' || navigator.userActivation?.hasBeenActive));
  const [heard, setHeard] = useState('');
  const [answer, setAnswer] = useState('');
  const [choices, setChoices] = useState([]);
  const [draft, setDraft] = useState({});
  const [invoice, setInvoice] = useState(null);
  const [typing, setTyping] = useState(false);
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  // A contact change said by voice, waiting for the fingerprint (spaces that have one).
  const [contactSign, setContactSign] = useState(null);
  const draftRef = useRef({});
  const last = useRef({ text: '', question: false, expecting: null });
  const silences = useRef(0);
  const failures = useRef(0);
  const stopRef = useRef(() => {});
  // Each listening session has a number; a session dropped on purpose (touch to open the
  // fingerprint sensor) is ignored when it ends.
  const listening = useRef(0);
  // After help or a mistake, the next sentence is said in full even in brief mode.
  const fullNext = useRef(false);
  const alive = useRef(true);
  const orbRef = useRef();
  const h1 = useRef();

  useEffect(() => {
    alive.current = true;
    document.title = `${v.voiceButton} · Kapyiŋi`;
    if (flow.pendingText) {
      // A sentence said on another page ("envoie vingt euros à mon frère") continues here.
      const text = flow.pendingText;
      setFlow((f) => ({ ...f, pendingText: null }));
      submit(text);
    } else if (flow.justOnboarded) {
      setFlow((f) => ({ ...f, justOnboarded: false }));
      respond(v.onboard.ready(userName), { question: true });
    } else if (flow.greetNow) {
      // Just signed in with the finger: that touch lets Kapyiŋi greet at once.
      setFlow((f) => ({ ...f, greetNow: false }));
      respond(v.greet(userName), { question: true });
    } else if (arg === 'listen') listen();
    else h1.current?.focus();
    return () => { alive.current = false; stopRef.current(); stopSpeaking(); };
  }, []);

  // Before the first touch: a touch anywhere wakes Kapyiŋi (buttons and links keep their own action).
  useEffect(() => {
    if (awake) return undefined;
    const wake = (e) => {
      if (e.target.closest?.('a, button, input, textarea, select, label')) return;
      onOrb();
    };
    document.addEventListener('click', wake);
    return () => document.removeEventListener('click', wake);
  });

  // Space: talk · Esc: stop · R: repeat (the team's design, laptop screens).
  useEffect(() => {
    const onKey = (e) => {
      if (e.target.closest?.('input, textarea, select')) return;
      if (e.code === 'Space') { e.preventDefault(); onOrb(); }
      else if (e.key === 'Escape') { stopRef.current(); stopSpeaking(); setPhase('idle'); }
      else if (e.key === 'r' || e.key === 'R') { if (last.current.text) respond(last.current.full || last.current.text, last.current); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const confirming = ['confirm', 'invoice_confirm'].includes(draft.stage);
  const wantsFinger = draft.stage === 'confirm' && draft.method === 'passkey';
  const orbState = phase !== 'idle' ? phase : wantsFinger || contactSign ? 'passkey' : confirming ? 'confirm' : 'idle';

  // ----- speaking -----
  // With Kapyiŋi's own voice we know when it stops, so it listens right after: until an answer
  // after a question, for a few seconds after anything else. Talking while it speaks interrupts
  // it (barge-in, see vad.js). With a screen reader we cannot know when VoiceOver or TalkBack has
  // finished, so the user touches the disc when ready. `after: 'none'`: do not listen (the
  // fingerprint sensor opens next).
  // `full`: the complete sentence when `raw` is the brief one; "répète" says the complete one.
  async function respond(raw, { question = false, expecting = null, override, after = 'auto', full = null } = {}) {
    if (!alive.current || !raw) return;
    const text = raw.charAt(0).toUpperCase() + raw.slice(1);
    last.current = { text, question, expecting, full };
    setAnswer(text);
    const ownVoice = (override?.output || output) === 'voice';
    setPhase(ownVoice ? 'speaking' : 'idle');
    let interrupted = false;
    const stopWatching = ownVoice && canListen && after !== 'none' && bargeInOn()
      ? watchForVoice({ onVoice: () => { interrupted = true; stopSpeaking(); } })
      : () => {};
    await say(text, override);
    stopWatching();
    if (!alive.current) return;
    setPhase('idle');
    if (!ownVoice || !canListen || after === 'none') return orbRef.current?.focus();
    if (interrupted) return listen({ echoOf: text });
    listen({ window: !question });
  }

  // ----- listening -----
  // `window`: nobody was asked anything, so listen for a few seconds only, then rest (battery,
  // privacy). `echoOf`: listening started by an interruption; a transcript that repeats that
  // sentence is Kapyiŋi hearing itself, and is ignored.
  async function listen({ window: short = false, echoOf = null } = {}) {
    if (!canListen) { setTyping(true); return respond(t.noMic); }
    stopRef.current();
    stopSpeaking();
    earcon.listen();
    setPhase('listening');
    const id = ++listening.current;
    let spoke = false;
    const session = listenOnce({ lang, onInterim: (x) => { if (x) { spoke = true; setHeard(x); } } });
    stopRef.current = session.stop;
    const timer = short ? setTimeout(() => { if (!spoke) session.stop(); }, LISTEN_WINDOW_MS) : null;
    let text = '';
    try {
      text = await session.promise;
    } catch (e) {
      clearTimeout(timer);
      if (!alive.current || id !== listening.current) return;
      setPhase('idle');
      if (e.message === 'denied') { setTyping(true); return respond(t.micDenied, { after: 'none' }); }
      if (short) { earcon.stop(); return; }
      failures.current += 1;
      return respond(failures.current >= 2 ? t.noisy : t.stillListening.default, { question: failures.current < 2, expecting: last.current.expecting });
    }
    clearTimeout(timer);
    if (!alive.current || id !== listening.current) return;
    earcon.stop();
    setPhase('idle');
    if (text && echoOf && isEcho(text, echoOf)) return listen({ window: !last.current.question });
    if (!text && short) return; // the listening window closed: back to rest, with the falling sound
    if (!text) {
      // Silence: one gentle reminder of what to say, then a pause. Silence never means "yes".
      silences.current += 1;
      if (silences.current === 1 && last.current.question) {
        return respond(t.stillListening[last.current.expecting] || t.stillListening.default, { question: true, expecting: last.current.expecting });
      }
      silences.current = 0;
      if (last.current.question) respond(t.paused);
      return;
    }
    silences.current = 0;
    failures.current = 0;
    submit(text);
  }

  function onOrb() {
    if (!awake) {
      // Next visits: browsers need one touch before Kapyiŋi may speak. Then it greets first.
      setAwake(true);
      return respond(v.greet(userName), { question: true });
    }
    // Waiting for the fingerprint: a touch opens the sensor, even while Kapyiŋi listens for "annule".
    if (phase === 'listening' && !wantsFinger && !contactSign) return stopRef.current();
    if (phase === 'listening') { listening.current += 1; stopRef.current(); earcon.stop(); }
    if (phase === 'thinking' || phase === 'passkey') return;
    if (wantsFinger) return fingerprint();
    if (contactSign) return contactFingerprint(contactSign);
    listen(); // also interrupts Kapyiŋi while it speaks
  }

  // ----- the fingerprint: the phone's sensor signs THIS payment; the server checks the signature -----
  // With `auto`, the sensor opens right after "oui". Some browsers (Safari) only open it after a
  // touch: when it is refused at once, Kapyiŋi asks for a touch on the disc instead.
  async function fingerprint({ auto = false } = {}) {
    if (busy) return;
    setBusy(true);
    setPhase('passkey');
    const startedAt = Date.now();
    const r = await confirmPayment(draftRef.current.prepareId, { passkey: true });
    if (!alive.current) return;
    setBusy(false);
    if (r.ok) return; // handOver() already speaks and opens PayPal
    const code = r.errors?.[0];
    if (auto && code === 'PASSKEY_CANCELLED' && Date.now() - startedAt < 1500) { setPhase('idle'); return respond(v.touchForFinger); }
    setPhase('problem');
    fullNext.current = true;
    if (code === 'CONFIRMATION_EXPIRED') { draftRef.current = {}; setDraft({}); return respond(t.errors.CONFIRMATION_EXPIRED); }
    await respond(code === 'PASSKEY_CANCELLED' ? v.passkeyCancelled : v.passkeyRefused, { question: true, expecting: 'yesno' });
  }

  // A contact change said by voice: the sensor signs it, the server checks and saves it.
  async function contactFingerprint(prepareId, { auto = false } = {}) {
    if (busy || !prepareId) return;
    setBusy(true);
    setPhase('passkey');
    const startedAt = Date.now();
    const s = await signPayment(prepareId);
    const r = s.error ? { ok: false, errors: [s.error] } : await api('/api/contacts/confirm', { body: { prepareId, passkey: s.response } });
    if (!alive.current) return;
    setBusy(false);
    setPhase('idle');
    const code = r.errors?.[0];
    if (r.ok) {
      setContactSign(null);
      draftRef.current = {};
      setDraft({});
      refreshConfig();
      return respond(r.op === 'remove' ? v.agent.CT_REMOVED({ name: r.name }) : v.agent.CT_SAVED({ op: r.op, name: r.name }));
    }
    if (auto && code === 'PASSKEY_CANCELLED' && Date.now() - startedAt < 1500) return respond(v.touchForFinger);
    if (code === 'PASSKEY_CANCELLED' || code === 'PASSKEY_REFUSED' || code === 'PASSKEY_REQUIRED') return respond(v.contactPasskeyRetry);
    setContactSign(null);
    draftRef.current = {};
    setDraft({});
    return respond(code === 'CONFIRMATION_EXPIRED' ? t.errors.CONFIRMATION_EXPIRED : v.agent.CT_FAILED({ errors: r.errors }));
  }

  // ----- understanding -----
  async function submit(text, { choiceId } = {}) {
    setAwake(true);
    // Pages, language, voice, speed: decided in the browser. "Répète" stays with the conversation.
    const local = localCommand(text);
    if (local && !local.repeat && !(local.nav === 'back' && draftRef.current.stage)) {
      setHeard(text);
      return runLocal(local, { ...kapyini, repeatText: last.current.full || last.current.text });
    }
    if (/^(mode classique|passe en mode classique|classic mode)$/i.test(text.trim())) return toClassic();
    setHeard(text);
    setChoices([]);
    setPhase('thinking');
    setBusy(true);
    const data = await api('/api/agent', { body: { text, draft: draftRef.current, lang, choiceId } });
    setBusy(false);
    if (!alive.current) return;
    if (!data.ok || !data.reply) { setPhase('idle'); return respond(t.errors[data.errors?.[0]] || t.errors.DEFAULT); }

    const { code, params = {} } = data.reply;
    if (code !== 'REPEAT' && code !== 'SETTING' && code !== 'HELP' && !code.startsWith('WHERE')) {
      draftRef.current = data.draft || {};
      setDraft(draftRef.current);
      setInvoice(params.invoice || null);
    }
    if (data.contactsChanged) refreshConfig();
    if (code !== 'CT_USE_PASSKEY') setContactSign(null);
    const expecting = data.draft?.expecting || null;
    const question = Boolean(expecting);
    if (REVIEWS.includes(code)) earcon.review();
    if (CONFIRMS.includes(code)) earcon.confirm();

    switch (code) {
      case 'CONFIRMED':
        return confirmPayment(data.prepareId).then((r) => { if (!r.ok) respond((r.errors || ['DEFAULT']).map((e) => t.errors[e] || t.errors.DEFAULT).join(' ')); });
      case 'USE_PASSKEY':
        setChoices([]);
        await respond(isBrief(config.account?.id) && v.brief ? v.brief.USE_PASSKEY() : v.agent.USE_PASSKEY(), { after: 'none' });
        return fingerprint({ auto: true });
      case 'CT_USE_PASSKEY':
        setChoices([]);
        setContactSign(data.prepareId);
        await respond(v.agent.CT_USE_PASSKEY(), { after: 'none' });
        return contactFingerprint(data.prepareId, { auto: true });
      case 'INVOICE_CONFIRMED':
        return handOver({ kind: 'invoice', url: data.payUrl, operationId: data.operationId });
      case 'REPEAT':
        // "Répète": always the complete sentence.
        return respond(last.current.full || last.current.text || t.agent.HELP(), { question: last.current.question, expecting: last.current.expecting });
      case 'SETTING': {
        const { key, value } = params;
        const override = {};
        if (key === 'lang') { setLang(value); override.lang = value; }
        if (key === 'output') { setOutput(value); override.output = value; }
        if (key === 'rate') {
          const next = value === 'slower' ? (rate === 'fast' ? 'normal' : 'slow') : (rate === 'slow' ? 'normal' : 'fast');
          setRate(next); override.rate = next;
        }
        return respond(STRINGS[override.lang || lang].agent.SETTING(params), { override });
      }
      case 'STATUS': {
        const s = await api(`/api/operations/${encodeURIComponent(params.operationId)}?refresh=1`);
        if (!alive.current) return;
        if (!s.ok) return respond(t.errors.DEFAULT);
        setChoices([{ label: t.seeDetail, href: `#status/${s.operation.id}` }]);
        return respond(t.agent.STATUS({ op: s.operation }, c));
      }
      case 'ACTIVITY':
        setChoices([{ label: t.homeActivity, href: '#activity' }]);
        return respond(t.agent.ACTIVITY(params, c));
      default: {
        setChoices((data.choices || []).map((ch) => {
          const lbl = ch.localized ? t.choiceLabels[ch.label] : ch.label;
          return {
            ...ch,
            label: typeof lbl === 'function' ? lbl(config.trusted?.name || '') : lbl,
            say: ch.localized && typeof t.choiceLabels[ch.say] === 'string' ? t.choiceLabels[ch.say] : ch.say,
          };
        }));
        const build = v.agent[code] || t.agent[code] || t.agent.NOT_UNDERSTOOD;
        const full = build(params, c);
        // Brief after the first successful payment, unless the last reply was help or a mistake.
        const short = isBrief(config.account?.id) && !fullNext.current && v.brief?.[code] ? v.brief[code](params, c) : null;
        fullNext.current = FULL_AFTER.has(code);
        return respond(short || full, { question, expecting, full: short ? full : null });
      }
    }
  }

  // Touch buttons for people who see the card: same rules (fingerprint when a passkey exists).
  async function sendByTouch() {
    if (busy) return;
    stopRef.current();
    if (draft.stage === 'invoice_confirm' && invoice) {
      setBusy(true);
      const r = await api(`/api/invoices/${encodeURIComponent(invoice.id)}/pay`, { body: {} });
      if (r.ok) return handOver({ kind: 'invoice', url: r.payUrl, operationId: r.operationId });
      setBusy(false);
      return respond((r.errors || ['DEFAULT']).map((e) => t.errors[e] || t.errors.DEFAULT).join(' '));
    }
    if (wantsFinger) return fingerprint();
    setBusy(true);
    const r = await confirmPayment(draft.prepareId);
    if (!r.ok) { setBusy(false); respond((r.errors || ['DEFAULT']).map((e) => t.errors[e] || t.errors.DEFAULT).join(' ')); }
  }

  async function toClassic() {
    stopRef.current();
    await say(v.switchedClassic);
    setMode('classic');
    go('#home');
  }

  const showCard = Boolean(draft.contactId || draft.amount || invoice);
  const pill = !awake ? v.pills.voice : { listening: v.pills.listening, thinking: v.pills.thinking, passkey: v.pills.passkey }[orbState] || (confirming ? v.pills.confirm : v.pills.voice);
  const hint = !awake ? v.resume : { idle: t.orb.idle, listening: t.orb.listening, thinking: t.orb.thinking, speaking: t.orb.speaking, confirm: t.orb.confirm, passkey: v.passkeyAsk, problem: t.orb.idle }[orbState];
  const orbLabel = !awake ? v.resume : contactSign && orbState === 'idle' ? v.contactPasskeyButton : wantsFinger ? v.passkeyButton(c.money(draft.amount, draft.currency)) : t.orbLabel[orbState] || t.orbLabel.idle;

  return (
    <div className="voice-theme flex flex-col">
      <VoiceHeader pill={pill} tone={orbState === 'problem' ? 'problem' : confirming ? 'key' : 'voice'} onClassic={toClassic} />
      <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col px-5 pb-10 sm:px-8">
        <h1 ref={h1} tabIndex={-1} className="sr-only">{v.voiceButton}</h1>
        {!config.sandboxReady && <p className="mx-auto mb-4 max-w-xl rounded-2xl border border-wait/50 bg-wait-soft px-4 py-3 text-center text-sm">{t.notConfigured}</p>}

        <div className={`grid flex-1 items-center gap-8 ${showCard ? 'lg:grid-cols-[minmax(0,1fr)_minmax(0,24rem)]' : ''}`}>
          <section aria-label="Kapyiŋi" className="flex flex-col items-center text-center">
            <div className="mt-6 sm:mt-10">
              <VoiceOrb ref={orbRef} state={orbState} small={showCard} label={orbLabel} onClick={onOrb} disabled={phase === 'thinking' || phase === 'passkey'} aria-pressed={phase === 'listening'} />
            </div>
            <p className="mt-10 text-base font-bold text-cyan" aria-hidden="true">{hint}</p>

            <div className="mt-6 w-full max-w-2xl">
              {answer ? (
                <>
                  <p className="text-sm text-slate" aria-hidden="true">Kapyiŋi</p>
                  <p key={answer} className="appear mt-1 text-2xl font-bold leading-snug sm:text-[1.9rem]">“{answer}”</p>
                </>
              ) : !awake ? (
                <p className="text-2xl font-bold">{v.resume}</p>
              ) : null}
              {heard && (
                <p className="mt-5 text-lg font-bold text-cyan sm:text-xl">
                  <span className="mr-2 align-middle text-sm font-normal text-slate">{t.youSaid}</span>“{heard}”
                </p>
              )}
            </div>

            {choices.length > 0 && (
              <ul className="mt-8 grid w-full max-w-md gap-3">
                {choices.map((ch, i) => (
                  <li key={`${ch.label}-${i}`}>
                    {ch.href ? (
                      <a className={`${btn.quiet} !bg-transparent`} href={ch.href} target={ch.href.startsWith('http') ? '_blank' : undefined} rel="noreferrer">{ch.label}</a>
                    ) : (
                      <button type="button" disabled={busy} onClick={() => (ch.typing ? setTyping(true) : submit(ch.say, { choiceId: ch.id }))}
                        className={ch.kind === 'yes' ? `${btn.primary} !bg-[#0070e0] !text-white` : `${btn.quiet} !bg-transparent`}>
                        <span aria-hidden="true" className="grid h-8 w-8 place-items-center rounded-full border-2 border-current text-base">{ch.n || i + 1}</span>
                        <span>{ch.label}</span>
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </section>

          {showCard && (
            <div className="w-full lg:sticky lg:top-6">
              {invoice ? (
                <InvoiceCard invoice={invoice} highlight={confirming}>
                  {confirming && <div className="mt-5 grid gap-3"><button type="button" className={`${btn.primary} !bg-[#0070e0] !text-white`} disabled={busy} onClick={sendByTouch}>{t.payButton(c.money(invoice.amount, invoice.currency))}</button></div>}
                </InvoiceCard>
              ) : (
                <TransactionCard draft={draft}>
                  {confirming && (
                    <div className="mt-5 grid gap-3">
                      <button type="button" className={`${btn.primary} !bg-[#0070e0] !text-white`} disabled={busy} onClick={sendByTouch}>
                        {wantsFinger ? v.passkeyButton(c.money(draft.amount, draft.currency)) : t.sendButton(c.money(draft.amount, draft.currency))}
                      </button>
                      <p className="text-center text-sm text-slate">{t.paypalNext}</p>
                    </div>
                  )}
                </TransactionCard>
              )}
            </div>
          )}
        </div>

        <div className="mx-auto mt-10 w-full max-w-md">
          {typing ? (
            <form className="grid gap-3" onSubmit={(e) => { e.preventDefault(); if (typed.trim()) { submit(typed.trim()); setTyped(''); } }}>
              <label htmlFor="typed" className="font-bold">{t.typeLabel}</label>
              <input id="typed" autoFocus value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" placeholder={t.typePlaceholder}
                className="min-h-14 w-full rounded-2xl border-2 border-line bg-mist px-4 text-lg text-text placeholder:text-slate" />
              <button type="submit" disabled={busy} className={`${btn.primary} !bg-[#0070e0] !text-white`}>{t.typeSend}</button>
            </form>
          ) : (
            <div className="flex flex-wrap justify-center gap-2 text-sm">
              {[[t.preferTyping, () => setTyping(true)], [t.homeActivity, () => go('#activity')], [t.homeInvoices, () => go('#invoices')], [t.homeSettings, () => go('#settings')]].map(([label, fn]) => (
                <button key={label} type="button" onClick={fn} className="min-h-12 rounded-full border border-line px-4 font-bold text-slate hover:text-text">{label}</button>
              ))}
            </div>
          )}
          <p className="mt-6 hidden text-center text-xs text-slate md:block" aria-hidden="true">{v.keys}</p>
        </div>
      </main>
    </div>
  );
}
