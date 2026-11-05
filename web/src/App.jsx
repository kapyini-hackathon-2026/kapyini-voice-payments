import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { STRINGS } from './lib/i18n.js';
import { amountInWords } from './lib/words.js';
import { api, money } from './lib/format.js';
import { read, write, readSession, writeSession } from './storage.js';
import { KapyiniContext } from './context.js';
import { speak, stopSpeaking } from './voice/speech.js';
import { signPayment } from './lib/passkey.js';
import ClassicHome from './screens/ClassicHome.jsx';
import Welcome from './screens/Welcome.jsx';
import Agent from './screens/Agent.jsx';
import Contacts from './screens/Contacts.jsx';
import Amount from './screens/Amount.jsx';
import Confirm from './screens/Confirm.jsx';
import Opening from './screens/Opening.jsx';
import Result from './screens/Result.jsx';
import Activity from './screens/Activity.jsx';
import Status from './screens/Status.jsx';
import Invoices from './screens/Invoices.jsx';
import Settings from './screens/Settings.jsx';

const SCREENS = { home: Agent, agent: Agent, send: Contacts, amount: Amount, confirm: Confirm, opening: Opening, result: Result, activity: Activity, status: Status, invoices: Invoices, settings: Settings };
const FALLBACK_CONFIG = { sandboxReady: false, contacts: [], currencies: ['EUR'], defaultCurrency: 'EUR', limit: '0', ai: null, invoicesReady: false };

function initialLang() {
  const saved = read('kapyini-lang');
  if (saved === 'fr' || saved === 'en') return saved;
  return navigator.language?.startsWith('fr') ? 'fr' : 'en';
}

// Hash router: "#status/abc" → ['status', 'abc']. Works with PayPal's return redirect (/#result/id).
function useHashRoute() {
  const parse = () => (window.location.hash.slice(1) || 'home').split('/');
  const [route, setRoute] = useState(parse);
  useEffect(() => {
    const onChange = () => setRoute(parse());
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  }, []);
  return route;
}

export default function App() {
  const [lang, setLangState] = useState(initialLang);
  // 'voice': Kapyiŋi's agent leads. 'classic': the usual screens, and Kapyiŋi stays silent.
  // Chosen by the user on the first launch, remembered, and changeable at any time.
  const [mode, setModeState] = useState(() => read('kapyini-mode') || (read('kapyini-output') ? 'voice' : null));
  const [output, setOutputState] = useState(() => read('kapyini-output', 'voice')); // who speaks in voice mode
  const [userName, setUserNameState] = useState(() => read('kapyini-name', ''));
  const [rate, setRateState] = useState(() => read('kapyini-rate', 'normal'));
  const [config, setConfig] = useState(null);
  const [flow, setFlow] = useState({});
  const [announcement, setAnnouncement] = useState('');
  const [name, arg] = useHashRoute();
  const timer = useRef();
  const prefs = useRef({ output, lang, rate, mode });
  prefs.current = { output, lang, rate, mode };

  useEffect(() => { api('/api/config').then((cfg) => setConfig(cfg.ok ? cfg : FALLBACK_CONFIG)); }, []);
  useEffect(() => { document.documentElement.lang = lang; }, [lang]);
  // Leaving a screen silences Kapyiŋi, so it never talks over the next screen.
  useEffect(() => stopSpeaking, [name]);

  // Coming back from PayPal's invoice page with the back button: go and check the result.
  useEffect(() => {
    const check = () => {
      const pending = readSession('kapyini-pending');
      if (pending && !window.location.hash.startsWith('#result/')) {
        writeSession('kapyini-pending', '');
        window.location.hash = `#result/${pending}`;
      }
    };
    check();
    const onShow = (e) => { if (e.persisted) check(); };
    window.addEventListener('pageshow', onShow);
    return () => window.removeEventListener('pageshow', onShow);
  }, []);

  const t = STRINGS[lang];
  const setLang = (l) => { setLangState(l); write('kapyini-lang', l); };
  const setOutput = (o) => { setOutputState(o); write('kapyini-output', o); };
  const setRate = (r) => { setRateState(r); write('kapyini-rate', r); };
  const setMode = (m) => { setModeState(m); write('kapyini-mode', m); };
  const setUserName = (n) => { setUserNameState(n); write('kapyini-name', n); };

  // The one way Kapyiŋi says something. The live region always gets the text (screen readers
  // read it); Kapyiŋi's own voice speaks only for people who said they have no screen reader.
  const say = useCallback((text, override = {}) => {
    if (!text) return Promise.resolve();
    const p = { ...prefs.current, ...override };
    clearTimeout(timer.current);
    setAnnouncement('');
    timer.current = setTimeout(() => setAnnouncement(text), 60);
    // Classic mode: never a voice. Voice mode with a screen reader: the screen reader speaks.
    return p.mode === 'voice' && p.output === 'voice' ? speak(text, p.lang, p.rate) : Promise.resolve();
  }, []);

  const go = (hash) => { window.location.hash = hash; };

  // Hand over to PayPal's own page, after saying what will happen there.
  const handOver = useCallback(async ({ kind, url, operationId }) => {
    writeSession('kapyini-pending', kind === 'invoice' ? operationId : '');
    setFlow((f) => ({ ...f, opening: { kind, url } }));
    go('#opening');
    const text = kind === 'invoice' ? STRINGS[prefs.current.lang].openingInvoice : STRINGS[prefs.current.lang].openingSend;
    await Promise.all([say(text), new Promise((r) => setTimeout(r, 2600))]);
    window.location.href = url;
  }, [say]);

  // Called by the Send button and by the amount said back: same single path to PayPal.
  // With `passkey: true`, the phone's sensor signs this payment first (voice mode).
  const confirmPayment = useCallback(async (prepareId, { passkey = false } = {}) => {
    let signed;
    if (passkey) {
      const s = await signPayment(prepareId);
      if (s.error) return { ok: false, errors: [s.error] };
      signed = s.response;
    }
    const data = await api('/api/send/confirm', {
      body: { prepareId, passkey: signed, locale: prefs.current.lang, simulateDecline: readSession('kapyini-simulate') === '1' },
    });
    if (!data.ok || !data.approveUrl) {
      if (data.operationId) go(`#result/${data.operationId}`);
      return { ok: false, errors: data.errors };
    }
    writeSession('kapyini-simulate', '0');
    await handOver({ kind: 'send', url: data.approveUrl, operationId: data.operationId });
    return { ok: true };
  }, [handOver]);

  const c = useMemo(() => {
    const fmt = (v, cur) => money(v, cur, lang);
    return {
      t,
      money: fmt,
      words: (v, cur) => amountInWords(v, cur, lang),
      date: (iso) => new Date(`${iso}T12:00:00`).toLocaleDateString(lang === 'fr' ? 'fr-FR' : 'en-US', { day: 'numeric', month: 'long' }),
      currencies: () => (config?.currencies || []).map((x) => t.currencyName[x] || x).join(` ${t.or} `),
      op: (op) => t.activityLine(amountInWords(op.amount, op.currency, lang), op.recipient?.name ?? op.merchant ?? '', t.states[op.state] || op.state),
    };
  }, [lang, t, config]);

  const ctx = useMemo(() => ({
    lang, setLang, t, c, output, setOutput, rate, setRate, mode, setMode, userName, setUserName,
    config, setConfig, flow, setFlow, say, go, confirmPayment, handOver,
  }), [lang, t, c, output, rate, mode, userName, config, flow, say, confirmPayment, handOver]);

  if (!config) return null;
  // The agent opens only in voice mode; classic mode stays on the classic screens.
  let Screen = SCREENS[name] || Agent;
  if (!mode) Screen = Welcome;
  else if (mode === 'classic' && (name === 'home' || name === 'agent' || !SCREENS[name])) Screen = ClassicHome;

  return (
    <KapyiniContext.Provider value={ctx}>
      {/* Everything Kapyiŋi "says" is written here; screen readers read it in their own voice. */}
      <div className="sr-only" aria-live="polite" aria-atomic="true">{announcement}</div>
      <Screen key={`${name}/${arg ?? ''}/${mode ?? ''}`} arg={arg} />
    </KapyiniContext.Provider>
  );
}
