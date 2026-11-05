// A microphone on every page, always in the same place (bottom right), so a user who cannot
// read can leave any screen by voice: "retour", "accueil", "ouvre mes opérations",
// "passe en anglais", "répète"… Anything else is handed to the agent on the main screen.
import { useEffect, useRef, useState } from 'react';
import { useKapyini } from '../context.js';
import { VOICE } from '../lib/voice-strings.js';
import { canListen, earcon, listenOnce, stopSpeaking } from '../voice/speech.js';
import { localCommand } from '../voice/commands.js';
import { runLocal } from '../voice/runLocal.js';
import { MicGlyph } from './ui.jsx';

export default function VoiceButton({ speakable = '' }) {
  const kapyini = useKapyini();
  const { lang, say, go, setFlow } = kapyini;
  const [listening, setListening] = useState(false);
  const stopRef = useRef(() => {});
  useEffect(() => () => stopRef.current(), []);
  if (!canListen) return null;
  const v = VOICE[lang];

  async function onClick() {
    if (listening) return stopRef.current();
    stopSpeaking();
    earcon.listen();
    setListening(true);
    const session = listenOnce({ lang });
    stopRef.current = session.stop;
    let text = '';
    try { text = await session.promise; } catch { /* handled below as silence */ }
    setListening(false);
    earcon.stop();
    if (!text) return say(v.noSpeech);
    const cmd = localCommand(text);
    if (cmd) return runLocal(cmd, { ...kapyini, repeatText: speakable });
    // Everything else ("envoie vingt euros à mon frère", "mon solde"…) goes to the agent.
    setFlow((f) => ({ ...f, pendingText: text }));
    go('#agent');
  }

  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={listening ? v.voiceListening : v.voiceButton}
      aria-pressed={listening}
      className={`fixed bottom-5 right-5 z-20 grid h-20 w-20 place-items-center rounded-full text-on-ink shadow-[0_14px_30px_-12px_rgba(0,28,100,0.7)] transition ${listening ? 'bg-blue scale-110' : 'bg-ink'}`}
    >
      <MicGlyph className="h-9 w-9" />
    </button>
  );
}
