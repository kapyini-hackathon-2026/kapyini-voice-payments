// "La carte qui se remplit": one card that completes itself as the conversation goes,
// instead of a scrolling chat. It doubles as the progress indicator.
import { Fragment } from 'react';
import { useKapyini } from '../context.js';
import { Avatar, TreeMark } from './ui.jsx';
import { VOICE } from '../lib/voice-strings.js';

function stepOf(draft, contact) {
  if (!contact) return 0;
  if (!draft.amount) return 1;
  if (draft.stage === 'confirm') return 3;
  return 2;
}

export function Steps({ current }) {
  const { t } = useKapyini();
  return (
    <ol className="mb-5 grid grid-cols-4 gap-2" aria-label={t.cardTitle}>
      {t.steps.map((label, i) => (
        <li key={label} aria-current={i === current ? 'step' : undefined} className="text-center">
          <span aria-hidden="true" className={`mb-1.5 block h-1.5 rounded-full ${i < current ? 'bg-ink' : i === current ? (i === 3 ? 'bg-key' : 'bg-blue') : 'bg-line'}`} />
          <span className={`text-sm ${i === current ? 'font-bold text-text' : 'text-slate'}`}>{label}</span>
        </li>
      ))}
    </ol>
  );
}

export default function TransactionCard({ draft, children }) {
  const { t, c, config, lang } = useKapyini();
  const index = config.contacts.findIndex((x) => x.id === draft.contactId);
  const contact = config.contacts[index];
  const current = stepOf(draft, contact);
  const confirming = draft.stage === 'confirm';
  const amountText = draft.amount ? (draft.currency ? c.money(draft.amount, draft.currency) : draft.amount) : null;

  return (
    <section aria-label={t.cardTitle} className={`appear rounded-3xl border-2 bg-paper p-5 shadow-[0_18px_40px_-28px_rgba(0,28,100,0.45)] sm:p-6 ${confirming ? 'border-key' : 'border-line'}`}>
      <Steps current={current} />
      <dl className="grid gap-4">
        <div className="flex items-center gap-4">
          {contact ? <Avatar name={contact.name} tone={index} /> : <span aria-hidden="true" className="h-14 w-14 shrink-0 rounded-full border-2 border-dashed border-line" />}
          <div>
            <dt className="text-sm text-slate">{t.cardWho}</dt>
            <dd className="text-xl font-bold">
              {contact ? contact.name : <span className="font-normal text-slate">{t.cardPending}</span>}
              {contact?.aliases?.[0] && <span className="ml-2 inline-block whitespace-nowrap rounded-full bg-mist px-2.5 py-0.5 align-middle text-sm font-normal text-slate">{contact.aliases[0]}</span>}
            </dd>
          </div>
        </div>
        <div className="border-t-2 border-mist pt-4">
          <dt className="text-sm text-slate">{t.cardHowMuch}</dt>
          {amountText ? (
            <dd>
              <span className="block text-5xl font-bold leading-none tracking-tight tabular-nums sm:text-6xl">{amountText}</span>
              {draft.currency && <span className="mt-2 block text-slate">{c.words(draft.amount, draft.currency)}</span>}
            </dd>
          ) : (
            <dd className="text-xl text-slate">{t.cardPending}</dd>
          )}
        </div>
      </dl>
      {confirming && (
        <p className="mt-5 flex items-center gap-3 rounded-2xl bg-wait-soft px-4 py-3 font-bold text-text">
          <TreeMark className="h-6 w-4 shrink-0" />
          <span>{draft.method === 'passkey' ? VOICE[lang].passkeyAsk : t.cardConfirmHint(c.words(draft.amount, draft.currency))}</span>
        </p>
      )}
      {children}
    </section>
  );
}

export function InvoiceCard({ invoice, highlight = false, children }) {
  const { t, c } = useKapyini();
  return (
    <section aria-label={t.invoiceTitle} className={`appear rounded-3xl border-2 bg-paper p-5 shadow-[0_18px_40px_-28px_rgba(0,28,100,0.45)] sm:p-6 ${highlight ? 'border-key' : 'border-line'}`}>
      <p className="mb-3 text-sm font-bold uppercase tracking-wide text-slate">{t.invoiceTitle}</p>
      <div className="flex items-center gap-4">
        <Avatar name={invoice.merchant || '?'} tone={2} />
        <div>
          <p className="text-sm text-slate">{t.invoiceFrom}</p>
          <p className="text-xl font-bold">{invoice.merchant}</p>
        </div>
      </div>
      <div className="mt-4 border-t-2 border-mist pt-4">
        <span className="block text-5xl font-bold leading-none tracking-tight tabular-nums">{c.money(invoice.amount, invoice.currency)}</span>
        <span className="mt-2 block text-slate">{c.words(invoice.amount, invoice.currency)}</span>
      </div>
      <dl className="mt-4 grid grid-cols-[max-content_1fr] gap-x-5 gap-y-1.5 text-base">
        {invoice.dueDate && <><dt className="text-slate">{t.invoiceDue}</dt><dd className="font-bold">{c.date(invoice.dueDate)}</dd></>}
        {invoice.number && <><dt className="text-slate">{t.invoiceNumber}</dt><dd className="font-bold">{invoice.number}</dd></>}
        {invoice.items?.map((it, i) => <Fragment key={i}><dt className="text-slate">{it.quantity} ×</dt><dd>{it.name}</dd></Fragment>)}
      </dl>
      {highlight && (
        <p className="mt-5 flex items-center gap-3 rounded-2xl bg-wait-soft px-4 py-3 font-bold">
          <TreeMark className="h-6 w-4 shrink-0" />
          <span>{t.cardConfirmHint(c.words(invoice.amount, invoice.currency)).replace('j’envoie', 'je paie').replace('I send', 'I pay')}</span>
        </p>
      )}
      {children}
    </section>
  );
}
