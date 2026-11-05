import { useEffect, useState } from 'react';
import { useKapyini } from '../context.js';
import { Page, btn } from '../components/ui.jsx';
import { api, shortDate } from '../lib/format.js';

export default function Status({ arg }) {
  const { t, c, lang, go } = useKapyini();
  const [op, setOp] = useState(null);
  const [note, setNote] = useState('');

  async function load(refresh) {
    const data = await api(`/api/operations/${encodeURIComponent(arg)}${refresh ? '?refresh=1' : ''}`);
    if (!data.ok) return go('#activity');
    setOp(data.operation);
    setNote(refresh ? (data.refreshFailed ? t.refreshFailed : t.refreshed) : '');
  }
  useEffect(() => { load(false); }, [arg]);

  const rows = op ? [
    [t.fieldState, t.states[op.state] || op.state],
    [t.fieldAmount, c.money(op.amount, op.currency)],
    op.kind === 'invoice' ? [t.fieldMerchant, op.merchant] : [t.fieldRecipient, op.recipient ? `${op.recipient.name} (${t.addressEnds(op.recipient.hint)})` : ''],
    [t.fieldDate, shortDate(op.createdAt, lang)],
    [t.fieldPayPal, op.captureId || op.orderId || op.invoiceId || '—'],
  ] : [];

  return (
    <Page title={t.statusTitle} back={{ href: '#activity', label: t.back }}>
      <dl className="mb-6 grid grid-cols-[max-content_1fr] gap-x-6 gap-y-3 rounded-3xl border-2 border-line p-5 text-lg">
        {rows.map(([k, v]) => [<dt key={`${k}t`} className="text-slate">{k}</dt>, <dd key={`${k}d`} className="font-bold [overflow-wrap:anywhere]">{v}</dd>])}
      </dl>
      <p role="status" className="mb-4 text-slate">{note}</p>
      <button type="button" className={btn.secondary} onClick={() => load(true)}>{t.refresh}</button>
    </Page>
  );
}
