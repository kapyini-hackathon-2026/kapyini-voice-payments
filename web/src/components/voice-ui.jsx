// Building blocks of the voice mode, after the team's design: the waveform disc and a quiet header.
import { forwardRef } from 'react';
import { useKapyini } from '../context.js';
import { VOICE } from '../lib/voice-strings.js';
import { TreeMark } from './ui.jsx';

export const VoiceOrb = forwardRef(function VoiceOrb({ state = 'idle', small = false, label, ...rest }, ref) {
  return (
    <button ref={ref} type="button" className={`vorb ${small ? 'small' : ''}`} data-state={state} aria-label={label} {...rest}>
      <span className="wave" aria-hidden="true"><i /><i /><i /><i /><i /><i /><i /></span>
      <svg className="glyph tick" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M4 12.5l5 5L20 6.5" /></svg>
      <svg className="glyph finger" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
        <path d="M12 3a8 8 0 0 0-8 8" /><path d="M20 11a8 8 0 0 0-4-6.9" /><path d="M7 12a5 5 0 0 1 10 0v1" /><path d="M12 12v4a6 6 0 0 1-1.5 4" /><path d="M9.5 15a9 9 0 0 1-.5 3" /><path d="M14.5 14.5V16a9 9 0 0 1-1 4" /><path d="M17 15.5a12 12 0 0 1-.6 3" />
      </svg>
    </button>
  );
});

export function VoiceHeader({ pill, onClassic, tone = 'voice' }) {
  const { lang } = useKapyini();
  const v = VOICE[lang];
  const pillTone = tone === 'problem' ? 'border-alert/50 text-alert' : tone === 'key' ? 'border-key/60 text-key' : 'border-line text-cyan';
  return (
    <header className="mx-auto flex w-full max-w-6xl items-center justify-between gap-3 px-5 py-4 sm:px-8">
      <a href="#home" className="inline-flex min-h-12 items-center gap-2.5 text-lg font-bold tracking-tight text-text no-underline">
        <TreeMark className="h-7 w-5" /><span className="tracking-[0.08em]" aria-label="Kapyiŋi">KAPYIŊI</span>
      </a>
      <div className="flex items-center gap-2">
        {pill && <span className={`hidden rounded-full border px-3 py-1 text-sm sm:inline-block ${pillTone}`} aria-hidden="true">{pill}</span>}
        {onClassic && (
          <button type="button" onClick={onClassic} className="min-h-12 rounded-full border border-line px-4 text-sm font-bold text-text hover:bg-mist">{v.toClassic}</button>
        )}
      </div>
    </header>
  );
}
