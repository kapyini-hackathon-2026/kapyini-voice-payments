// Confirmation for the keyboard path (sighted users). Same card and same rule as the voice path:
// touch "Send", or say the amount back. "Oui" alone is never enough.
import { useEffect, useRef, useState } from 'react';
import { useKapyini } from '../context.js';
import { Page, MicGlyph, btn } from '../components/ui.jsx';
import TransactionCard from '../components/TransactionCard.jsx';
import { api } from '../lib/format.js';
import { canListen, earcon, listenOnce } from '../voice/speech.js';

export default function Confirm() {
  const { t, c, lang, flow, setFlow, say, go, output, confirmPayment } = useKapyini();
  const [busy, setBusy] = useState(false);
  const [listening, setListening] = useState(false);
  const [message, setMessage] = useState('');
  const stopRef = useRef(() => {});
  const s = flow.summary;
  const words = s ? c.words(s.amount, s.currency) : '';
  const title = s ? t.confirmTitle(words, s.recipient.name) : '';
  const draft = s ? { stage: 'confirm', contactId: s.recipient.id, amount: s.amount, currency: s.currency, prepareId: flow.prepareId } : {};

  useEffect(() => {
    if (!s) { go('#home'); return; }
    earcon.confirm();
    if (output === 'voice') say(`${title} ${t.agent.CONFIRM_ASK({ summary: s }, c)}`);
    return () => stopRef.current();
  }, []);
  if (!s) return null;

  async function send() {
    if (busy) return;
    setBusy(true);
    stopRef.current();
    const r = await confirmPayment(flow.prepareId);
    if (!r.ok) { setMessage((r.errors || ['DEFAULT']).map((e) => t.errors[e] || t.errors.DEFAULT).join(' ')); }
  }
  function cancel() {
    stopRef.current();
    setFlow((f) => ({ ...f, prepareId: null, summary: null }));
    say(t.cancelledByUser);
    go('#home');
  }
  async function byVoice() {
    earcon.listen();
    setListening(true);
    const session = listenOnce({ lang, onInterim: setMessage });
    stopRef.current = session.stop;
    let text = '';
    try { text = await session.promise; } catch (e) { setMessage(e.message === 'denied' ? t.micDenied : t.noMic); }
    setListening(false);
    earcon.stop();
    if (!text) return;
    const data = await api('/api/agent', { body: { text, draft, lang } });
    const code = data.reply?.code;
    if (code === 'CONFIRMED') return send();
    if (code === 'CANCELLED') return cancel();
    const reply = (t.agent[code] || t.agent.SAY_AMOUNT)(data.reply?.params || { summary: s }, c);
    setMessage(reply);
    say(reply);
  }

  return (
    <Page title={title} back={{ href: '#amount', label: t.back }}>
      <TransactionCard draft={draft}>
        <div className="mt-5 grid gap-3">
          <button type="button" className={btn.primary} disabled={busy} onClick={send}>{t.sendButton(c.money(s.amount, s.currency))}</button>
          <button type="button" className={btn.secondary} onClick={cancel}>{t.cancel}</button>
          {canListen && (
            <button type="button" className={btn.quiet} disabled={busy || listening} onClick={byVoice}>
              <MicGlyph className="h-6 w-6" /><span>{listening ? t.orb.listening : t.answerByVoice}</span>
            </button>
          )}
        </div>
      </TransactionCard>
      <p className="mt-4 text-center text-slate">{t.paypalNext}</p>
      {message && <p role="status" className="mt-4 text-center text-lg font-bold">{message}</p>}
    </Page>
  );
}
