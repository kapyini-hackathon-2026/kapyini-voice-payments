import { useEffect, useState } from 'react';
import { useKapyini } from '../context.js';
import { Avatar, Page, toneClass } from '../components/ui.jsx';
import { api, shortDate, toneOf } from '../lib/format.js';

export default function Activity() {
  const { t, c, lang, output, say } = useKapyini();
  const [ops, setOps] = useState(null);
  useEffect(() => {
    api('/api/operations').then((d) => {
      const list = d.operations || [];
      setOps(list);
      // With Kapyiŋi's own voice, the page reads itself: the three latest payments.
      if (output === 'voice') say(list.length ? t.agent.ACTIVITY({ ops: list.slice(0, 3) }, c) : t.activityEmpty);
    });
  }, []);
  return (
    <Page title={t.activityTitle} back={{ href: '#home', label: t.back }}>
      {ops && ops.length === 0 && <p className="text-xl text-slate">{t.activityEmpty}</p>}
      <ul className="grid gap-3">
        {(ops || []).map((op) => {
          const label = t.states[op.state] || op.state;
          const who = op.recipient?.name ?? op.merchant ?? '';
          return (
            <li key={op.id}>
              <a href={`#status/${op.id}`} aria-label={t.activityLine(c.money(op.amount, op.currency), who, label)}
                className="flex min-h-20 items-center gap-4 rounded-2xl border-2 border-line bg-paper px-4 py-3 text-text no-underline hover:border-text">
                <Avatar name={who} tone={op.kind === 'invoice' ? 2 : 0} size="h-12 w-12 text-base" />
                <span className="flex-1">
                  <strong className="block text-xl tabular-nums">{c.money(op.amount, op.currency)}</strong>
                  <span className="text-slate">{who} · {shortDate(op.createdAt, lang)}</span>
                </span>
                <span className={`rounded-full border-2 px-3 py-0.5 text-sm font-bold ${toneClass[toneOf(op.state)]}`}>{label}</span>
              </a>
            </li>
          );
        })}
      </ul>
    </Page>
  );
}
