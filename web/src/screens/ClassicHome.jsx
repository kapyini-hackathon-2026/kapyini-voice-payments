// Classic mode: the usual screens, by touch and keyboard. Kapyiŋi stays silent here.
// (A PayPal-inspired layout for the concept demo — no PayPal logo, no login form: PayPal's own
// pages do the login and the approval.)
import { useEffect, useRef, useState } from 'react';
import { useKapyini } from '../context.js';
import { VOICE } from '../lib/voice-strings.js';
import { api, shortDate, toneOf } from '../lib/format.js';
import { Avatar, Header, MicGlyph, toneClass } from '../components/ui.jsx';

function Tile({ href, icon, title, hint, badge }) {
  return (
    <a href={href} className="group flex min-h-36 flex-col justify-between rounded-3xl border border-line bg-paper p-5 text-text no-underline shadow-[0_18px_40px_-30px_rgba(0,28,100,0.5)] transition hover:-translate-y-0.5 hover:border-text">
      <span aria-hidden="true" className="grid h-12 w-12 place-items-center rounded-2xl bg-sky text-2xl text-blue">{icon}</span>
      <span>
        <strong className="flex items-center gap-2 text-xl">{title}{badge && <span className="rounded-full bg-key px-2.5 py-0.5 text-sm text-[#001c64]">{badge}</span>}</strong>
        <span className="text-slate">{hint}</span>
      </span>
    </a>
  );
}

export default function ClassicHome() {
  const { t, c, lang, config, userName, setMode, go } = useKapyini();
  const v = VOICE[lang].classic;
  const [ops, setOps] = useState(null);
  const [bills, setBills] = useState(0);
  const h1 = useRef();
  useEffect(() => {
    document.title = 'Kapyiŋi';
    h1.current?.focus();
    api('/api/operations').then((d) => setOps((d.operations || []).slice(0, 3)));
    if (config.invoicesReady) api('/api/invoices').then((d) => setBills(d.invoices?.length || 0));
  }, []);

  return (
    <div className="min-h-dvh bg-mist/60">
      <Header />
      <main className="mx-auto max-w-5xl px-4 pb-16 sm:px-6">
        <section className="mb-8 mt-2 rounded-[2rem] bg-[#003087] px-6 py-8 text-white sm:px-10 sm:py-10">
          <h1 ref={h1} tabIndex={-1} className="text-3xl font-bold tracking-tight sm:text-4xl">{v.hello(userName)}</h1>
          <p className="mt-2 text-lg text-white/80">{v.intro}</p>
          <p className="mt-6 inline-block rounded-full bg-white/10 px-3 py-1 text-sm text-white/80">{v.sandbox}</p>
        </section>
        {!config.sandboxReady && <p className="mb-6 rounded-2xl border-l-8 border-wait bg-wait-soft px-4 py-3">{t.notConfigured}</p>}

        <nav aria-label={v.intro} className="grid gap-4 sm:grid-cols-3">
          <Tile href="#send" icon="↗" title={v.send} hint={v.sendHint} />
          <Tile href="#invoices" icon="€" title={v.invoices} hint={v.invoicesHint} badge={bills ? t.invoicesBadge(bills) : null} />
          <Tile href="#activity" icon="≡" title={v.activity} hint={v.activityHint} />
        </nav>

        <section className="mt-10" aria-labelledby="recent">
          <div className="mb-3 flex items-baseline justify-between">
            <h2 id="recent" className="text-xl font-bold">{v.recent}</h2>
            <a href="#activity" className="font-bold text-blue">{v.seeAll}</a>
          </div>
          {ops && ops.length === 0 && <p className="text-slate">{v.none}</p>}
          <ul className="grid gap-2">
            {(ops || []).map((op) => {
              const who = op.recipient?.name ?? op.merchant ?? '';
              return (
                <li key={op.id}>
                  <a href={`#status/${op.id}`} className="flex min-h-16 items-center gap-4 rounded-2xl bg-paper px-4 py-3 text-text no-underline hover:bg-sky">
                    <Avatar name={who} size="h-11 w-11 text-sm" tone={op.kind === 'invoice' ? 2 : 0} />
                    <span className="flex-1"><strong className="block">{who}</strong><span className="text-sm text-slate">{shortDate(op.createdAt, lang)}</span></span>
                    <span className="text-right">
                      <strong className="block tabular-nums">−{c.money(op.amount, op.currency)}</strong>
                      <span className={`rounded-full border px-2 py-0.5 text-xs font-bold ${toneClass[toneOf(op.state)]}`}>{t.states[op.state] || op.state}</span>
                    </span>
                  </a>
                </li>
              );
            })}
          </ul>
        </section>

        <button type="button" onClick={() => { setMode('voice'); go('#home'); }}
          className="mt-10 flex w-full items-center gap-4 rounded-3xl border-2 border-dashed border-line bg-paper px-5 py-5 text-left hover:border-text">
          <span aria-hidden="true" className="grid h-12 w-12 shrink-0 place-items-center rounded-full bg-[#0070e0] text-white"><MicGlyph className="h-6 w-6" /></span>
          <span><strong className="block text-lg">{VOICE[lang].toVoice}</strong><span className="text-slate">{VOICE[lang].toVoiceHint}</span></span>
        </button>
      </main>
    </div>
  );
}
