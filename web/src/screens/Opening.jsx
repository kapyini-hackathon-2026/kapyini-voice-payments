// The hand-over: Kapyiŋi cannot speak on PayPal's page and must not try to act there,
// so it says exactly what will happen before leaving.
import { useKapyini } from '../context.js';
import { Page, btn } from '../components/ui.jsx';

export default function Opening() {
  const { t, flow } = useKapyini();
  const o = flow.opening || {};
  return (
    <Page title={t.openingTitle}>
      <p className="mb-6 text-xl leading-snug">{o.kind === 'invoice' ? t.openingInvoice : t.openingSend}</p>
      <ol className="mb-8 grid gap-3">
        {t.openingSteps.map((step, i) => (
          <li key={step} className="flex min-h-16 items-center gap-4 rounded-2xl border-2 border-line px-4">
            <span aria-hidden="true" className={`grid h-10 w-10 shrink-0 place-items-center rounded-full text-lg font-bold ${i === 0 ? 'bg-ink text-on-ink' : 'bg-mist'}`}>{i + 1}</span>
            <span className="text-lg font-bold">{step}</span>
          </li>
        ))}
      </ol>
      <div className="flex items-center gap-4">
        <span aria-hidden="true" className="spinner h-10 w-10 shrink-0 rounded-full border-4 border-line border-t-text" />
        {o.url && <a className={btn.secondary} href={o.url}>{t.openNow}</a>}
      </div>
    </Page>
  );
}
