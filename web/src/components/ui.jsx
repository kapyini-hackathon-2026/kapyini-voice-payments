// Shared building blocks. Native elements only: every control is a real <button> or <a>,
// so VoiceOver and TalkBack understand it without extra work.
import { useEffect, useRef } from 'react';
import { useKapyini } from '../context.js';
import VoiceButton from './VoiceButton.jsx';

// Kapyiŋi means "tree" in Senoufo: the mark is a tree, in the saffron reserved for the logo,
// the confirmation and the focus ring.
export function TreeMark({ className = '', color = 'var(--key)' }) {
  return (
    <svg viewBox="0 0 24 34" className={className} aria-hidden="true">
      <circle cx="12" cy="9" r="7.5" fill={color} />
      <circle cx="6.5" cy="15" r="5.5" fill={color} />
      <circle cx="17.5" cy="15" r="5.5" fill={color} />
      <path d="M10.4 17h3.2v11.5l3.4 4.5H7l3.4-4.5z" fill={color} />
    </svg>
  );
}

export function MicGlyph({ className = '' }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="9" y="2.5" width="6" height="12" rx="3" />
      <path d="M5 11a7 7 0 0 0 14 0" />
      <path d="M12 18v3.5" />
    </svg>
  );
}

export function Tick({ className = '' }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M4 12.5l5 5L20 6.5" />
    </svg>
  );
}

export function Header() {
  const { t, lang, mode, setMode, go } = useKapyini();
  const toVoice = lang === 'fr' ? 'Mode vocal' : 'Voice mode';
  const toClassic = lang === 'fr' ? 'Mode classique' : 'Classic mode';
  return (
    <header className="mx-auto flex max-w-5xl items-center justify-between px-4 py-4 sm:px-6">
      <a href="#home" className="inline-flex min-h-12 items-center gap-2.5 rounded-xl text-xl font-bold tracking-tight text-text no-underline">
        <TreeMark className="h-8 w-6" />
        <span className="text-lg tracking-[0.06em] sm:text-xl" aria-label="Kapyiŋi">KAPYIŊI</span>
      </a>
      <div className="flex items-center gap-2">
        <span className="hidden rounded-full border-2 border-line px-3 py-1 text-sm text-slate sm:inline-block">{t.sandboxPill}</span>
        {/* The mode can be changed from every screen, in one touch. */}
        <button type="button" onClick={() => { setMode(mode === 'voice' ? 'classic' : 'voice'); go('#home'); }}
          className={`inline-flex min-h-12 items-center gap-2 whitespace-nowrap rounded-full px-3 text-sm font-bold sm:px-4 ${mode === 'voice' ? 'border-2 border-line text-text' : 'bg-[#0070e0] text-white'}`}>
          {mode !== 'voice' && <MicGlyph className="h-5 w-5" />}{mode === 'voice' ? toClassic : toVoice}
        </button>
        <a href="#settings" className="grid h-12 w-12 place-items-center rounded-full text-slate hover:bg-mist" aria-label={t.homeSettings}>
          <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
            <circle cx="12" cy="12" r="3.2" />
            <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" />
          </svg>
        </a>
      </div>
    </header>
  );
}

// A page with one h1 that takes focus, so a screen reader says where the user is.
export function Page({ title, back, hideTitle = false, focusTitle = true, wide = false, before, speakable = '', children }) {
  const { mode } = useKapyini();
  const h1 = useRef();
  useEffect(() => { if (focusTitle) h1.current?.focus(); window.scrollTo(0, 0); }, [focusTitle]);
  useEffect(() => { document.title = title ? `${title} · Kapyiŋi` : 'Kapyiŋi'; }, [title]);
  // Voice mode keeps its night-blue stage on every screen; classic mode keeps the light screens.
  return (
    <div className={mode === 'voice' ? 'voice-theme' : 'min-h-dvh'}>
      <Header />
      <main className={`mx-auto px-4 pb-32 sm:px-6 ${wide ? 'max-w-5xl' : 'max-w-xl'}`}>
        {back && (
          <a href={back.href} className="mb-2 inline-flex min-h-12 items-center gap-2 font-bold text-text no-underline">
            <span aria-hidden="true" className="text-2xl leading-none">‹</span>{back.label}
          </a>
        )}
        {before}
        <h1 ref={h1} tabIndex={-1} className={hideTitle ? 'sr-only' : 'mb-6 mt-2 text-3xl font-bold leading-tight tracking-tight sm:text-4xl'}>{title}</h1>
        <div className="appear">{children}</div>
      </main>
      {mode === 'voice' && <VoiceButton speakable={speakable || title} />}
    </div>
  );
}

const BTN = 'inline-flex w-full min-h-16 items-center justify-center gap-3 rounded-2xl px-5 text-lg font-bold no-underline transition disabled:opacity-55';
export const btn = {
  primary: `${BTN} bg-ink text-on-ink hover:opacity-90`,
  secondary: `${BTN} border-2 border-text bg-paper text-text hover:bg-mist`,
  quiet: `${BTN} border-2 border-line bg-paper text-text hover:bg-mist`,
  danger: `${BTN} border-2 border-stop bg-paper text-stop hover:bg-stop-soft`,
};

export function Avatar({ name = '', size = 'h-14 w-14 text-lg', tone = 0 }) {
  // A colour per contact helps people who do not read the letters.
  const palette = ['bg-sky text-blue', 'bg-go-soft text-go', 'bg-wait-soft text-wait', 'bg-mist text-text'];
  const init = name.split(/\s+/).map((w) => w[0]).slice(0, 2).join('').toUpperCase();
  return <span aria-hidden="true" className={`grid shrink-0 place-items-center rounded-full font-bold ${size} ${palette.at(tone % palette.length)}`}>{init}</span>;
}

export const toneClass = {
  go: 'bg-go-soft text-go border-go',
  wait: 'bg-wait-soft text-wait border-wait',
  stop: 'bg-stop-soft text-stop border-stop',
  '': 'bg-mist text-slate border-line',
};
