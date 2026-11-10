// The result is announced once, only from what PayPal says, with a sound reserved for success.
import { useEffect, useState } from 'react';
import { useKapyini } from '../context.js';
import { Page, Tick, btn } from '../components/ui.jsx';
import { api, toneOf } from '../lib/format.js';
import { earcon } from '../voice/speech.js';
import { countSuccess } from '../voice/brevity.js';

export default function Result({ arg }) {
  const { t, c, lang, say, go, config } = useKapyini();
  const [op, setOp] = useState(null);
  const [checking, setChecking] = useState(false);

  const texts = (o) => {
    const table = o.kind === 'invoice' ? t.invoiceResult : t.result;
    const [title, body] = table[o.state] || table.awaiting_approval || t.result.unverified;
    const text = body(o, c);
    return { title, body: text.charAt(0).toUpperCase() + text.slice(1) };
  };

  async function load(announce = true) {
    setChecking(true);
    const data = await api(`/api/operations/${encodeURIComponent(arg)}?refresh=1`);
    setChecking(false);
    if (!data.ok) return go('#home');
    const o = data.operation;
    setOp(o);
    if (!announce) return;
    // Confirmed by PayPal: from now on Kapyiŋi can be brief with this user (voice/brevity.js).
    if (o.state === 'completed') countSuccess(config.account?.id, o.id);
    if (o.state === 'completed') earcon.success(); else if (toneOf(o.state) === 'stop') earcon.problem();
    const { title, body } = texts(o);
    say(`${title} ${body}`);
  }
  useEffect(() => { load(); }, [arg]);

  if (!op) return <Page title="…"><span aria-hidden="true" className="spinner block h-12 w-12 rounded-full border-4 border-line border-t-text" /></Page>;
  const tone = toneOf(op.state);
  const { title, body } = texts(op);
  const disc = { go: 'bg-go', stop: 'bg-stop', wait: 'bg-wait', '': 'bg-slate' }[tone];

  return (
    <Page
      title={title}
      speakable={`${title} ${body}`}
      focusTitle={false /* announced once through the live region */}
      before={<div aria-hidden="true" className={`appear mt-4 grid h-28 w-28 place-items-center rounded-full text-on-ink ${disc}`}>{tone === 'go' ? <Tick className="h-14 w-14" /> : <span className="text-5xl font-bold">{tone === 'stop' ? '✕' : '!'}</span>}</div>}
    >
      <p className="mb-2 text-2xl leading-snug">{body}</p>
      {op.state === 'failed' && op.reason && <p className="text-slate">{t.reasonLabel}{lang === 'fr' ? ' :' : ':'} {op.reason}</p>}
      <div className="mt-8 grid gap-3">
        <button type="button" className={btn.primary} onClick={() => say(`${title} ${body}`)}>{t.repeat}</button>
        {op.state !== 'completed' && <button type="button" className={btn.secondary} disabled={checking} onClick={() => load(true)}>{t.checkAgain}</button>}
        <a className={btn.secondary} href={`#status/${op.id}`}>{t.seeDetail}</a>
        <a className={btn.quiet} href="#home">{t.done}</a>
      </div>
    </Page>
  );
}
