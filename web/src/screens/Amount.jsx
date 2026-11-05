import { useEffect, useRef, useState } from 'react';
import { useKapyini } from '../context.js';
import { Page, btn } from '../components/ui.jsx';
import { api } from '../lib/format.js';

export default function Amount() {
  const { t, c, config, flow, setFlow, go } = useKapyini();
  const [amount, setAmount] = useState('');
  const [currency, setCurrency] = useState(flow.currency || config.defaultCurrency);
  const [errors, setErrors] = useState([]);
  const [lastRequest, setLastRequest] = useState(null);
  const input = useRef();

  useEffect(() => { if (!flow.contact) go('#send'); }, [flow.contact]);
  if (!flow.contact) return null;

  async function prepare(request) {
    setLastRequest(request);
    const data = await api('/api/send/prepare', { body: request });
    if (!data.ok) { setErrors(data.errors || ['DEFAULT']); input.current?.focus(); return; }
    setFlow((f) => ({ ...f, currency, prepareId: data.prepareId, summary: data.summary, request }));
    go('#confirm');
  }

  return (
    <Page title={t.amountTitle(flow.contact.name)} back={{ href: '#send', label: t.back }}>
      <form noValidate className="grid gap-6" onSubmit={(e) => { e.preventDefault(); prepare({ contactId: flow.contact.id, amount, currency }); }}>
        <div>
          <label htmlFor="amount-input" className="mb-2 block font-bold">{t.amountLabel}</label>
          <input id="amount-input" ref={input} inputMode="decimal" autoComplete="off" value={amount} onChange={(e) => setAmount(e.target.value)}
            aria-describedby="limit-note amount-error"
            className="w-full rounded-2xl border-2 border-text bg-paper px-4 py-3 text-5xl font-bold tabular-nums text-text" />
        </div>
        <fieldset>
          <legend className="mb-2 font-bold">{t.currencyLabel}</legend>
          <div className="flex flex-wrap gap-3">
            {config.currencies.map((cur) => (
              <label key={cur} className="inline-flex min-h-14 cursor-pointer items-center gap-3 rounded-2xl border-2 border-line px-5 font-bold has-[:checked]:border-text has-[:checked]:bg-mist">
                <input type="radio" name="currency" value={cur} checked={cur === currency} onChange={() => setCurrency(cur)} className="h-6 w-6 accent-[var(--text)]" />
                {t.currencyName[cur] || cur}
              </label>
            ))}
          </div>
        </fieldset>
        <p id="limit-note" className="text-slate">{t.limitNote(c.money(config.limit, currency))}</p>
        <div id="amount-error" role="alert" className="font-bold text-stop empty:hidden">
          {errors.length > 0 && <p className="mb-3">{errors.map((e) => t.errors[e] || t.errors.DEFAULT).join(' ')}</p>}
          {errors.includes('POSSIBLE_DUPLICATE') && <button type="button" className={btn.secondary} onClick={() => prepare({ ...lastRequest, allowDuplicate: true })}>{t.sendAnyway}</button>}
        </div>
        <button className={btn.primary} type="submit">{t.check}</button>
      </form>
    </Page>
  );
}
