import { useKapyini } from '../context.js';
import { Avatar, Page } from '../components/ui.jsx';
import { VOICE } from '../lib/voice-strings.js';

export default function Contacts() {
  const { t, lang, config, setFlow, go } = useKapyini();
  const p = VOICE[lang].people;
  return (
    <Page title={t.contactsTitle} back={{ href: '#home', label: t.back }}>
      <ul className="grid gap-3">
        {config.contacts.map((ct, i) => (
          <li key={ct.id}>
            <button type="button" onClick={() => { setFlow((f) => ({ ...f, contact: ct })); go('#amount'); }}
              className="flex min-h-20 w-full items-center gap-4 rounded-2xl border-2 border-line bg-paper px-4 py-3 text-left hover:border-text">
              <Avatar name={ct.name} tone={i} />
              <span>
                <strong className="block text-xl">{ct.name}{ct.aliases?.[0] && <span className="ml-2 rounded-full bg-mist px-2.5 py-0.5 text-sm font-normal text-slate">{ct.aliases[0]}</span>}</strong>
                <span className="text-slate">{t.addressEnds(ct.hint)}</span>
              </span>
            </button>
          </li>
        ))}
      </ul>
      {config.contacts.length === 0 && <p className="text-xl text-slate">{p.empty}</p>}
      <p className="mt-6"><a href="#people" className="inline-flex min-h-12 items-center font-bold text-blue">{VOICE[lang].space.contactsLink} ›</a></p>
    </Page>
  );
}
