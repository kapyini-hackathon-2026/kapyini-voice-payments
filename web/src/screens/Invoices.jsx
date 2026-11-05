// Payment requests, for people who see the screen: every bill as a card, read aloud on demand,
// and a two-step "Pay" (check, then pay on PayPal's own page).
import { useEffect, useState } from 'react';
import { useKapyini } from '../context.js';
import { Page, btn } from '../components/ui.jsx';
import { InvoiceCard } from '../components/TransactionCard.jsx';
import { api } from '../lib/format.js';

export default function Invoices() {
  const { t, c, config, say, handOver, output } = useKapyini();
  const [list, setList] = useState(null);
  const [error, setError] = useState('');
  const [checking, setChecking] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!config.invoicesReady) { setList([]); return; }
    api('/api/invoices').then((d) => {
      if (!d.ok) setError((d.errors || ['DEFAULT']).map((e) => t.errors[e] || t.errors.DEFAULT).join(' '));
      const list = d.invoices || [];
      setList(list);
      if (output === 'voice' && d.ok) say(list.length ? t.agent.INVOICE_PICK({ invoices: list }, c).replace(/ Laquelle.*$| Which one.*$/, ' Dites : je veux payer ma facture.') : t.invoicesEmpty);
    });
  }, []);

  async function pay(inv) {
    setBusy(true);
    const r = await api(`/api/invoices/${encodeURIComponent(inv.id)}/pay`, { body: {} });
    if (r.ok) return handOver({ kind: 'invoice', url: r.payUrl, operationId: r.operationId });
    setBusy(false);
    setError((r.errors || ['DEFAULT']).map((e) => t.errors[e] || t.errors.DEFAULT).join(' '));
  }

  return (
    <Page title={t.invoicesTitle} back={{ href: '#home', label: t.back }}>
      <p className="mb-6 text-lg text-slate">{t.invoicesIntro}</p>
      {!config.invoicesReady && <p className="rounded-2xl border-l-8 border-wait bg-wait-soft px-4 py-3">{t.invoicesOff}</p>}
      {error && <p role="alert" className="mb-4 font-bold text-stop">{error}</p>}
      {list && config.invoicesReady && list.length === 0 && !error && <p className="text-xl text-slate">{t.invoicesEmpty}</p>}
      {list === null && <span aria-hidden="true" className="spinner block h-10 w-10 rounded-full border-4 border-line border-t-text" />}
      <ul className="grid gap-5">
        {(list || []).map((inv) => (
          <li key={inv.id}>
            <InvoiceCard invoice={inv} highlight={checking === inv.id}>
              <div className="mt-5 grid gap-3">
                {checking === inv.id ? (
                  <>
                    <p className="text-xl font-bold">{t.payConfirmTitle(c.words(inv.amount, inv.currency), inv.merchant)}</p>
                    <button type="button" className={btn.primary} disabled={busy} onClick={() => pay(inv)}>{t.payButton(c.money(inv.amount, inv.currency))}</button>
                    <button type="button" className={btn.secondary} onClick={() => setChecking(null)}>{t.cancel}</button>
                  </>
                ) : (
                  <>
                    <button type="button" className={btn.primary} onClick={() => setChecking(inv.id)}>{t.payThis}</button>
                    <button type="button" className={btn.quiet} onClick={() => say(t.agent.INVOICE_REVIEW({ invoice: inv }, c).replace(/ Voulez-vous la payer.*$| Do you want to pay it.*$/, ''), { output: 'voice' })}>{t.readAloud}</button>
                  </>
                )}
              </div>
            </InvoiceCard>
          </li>
        ))}
      </ul>
    </Page>
  );
}
