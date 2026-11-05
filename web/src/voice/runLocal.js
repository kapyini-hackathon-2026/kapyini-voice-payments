// Carries out a command found by localCommand(), and says what it did.
import { STRINGS } from '../lib/i18n.js';
import { VOICE } from '../lib/voice-strings.js';

export async function runLocal(cmd, { lang, rate, setLang, setOutput, setRate, say, go, repeatText = '' }) {
  if (cmd.repeat) return say(repeatText || STRINGS[lang].agent.HELP());
  if (cmd.nav === 'back') {
    await say(VOICE[lang].goingBack);
    if (window.history.length > 1) window.history.back(); else go('#home');
    return;
  }
  if (cmd.nav) {
    await say(VOICE[lang].opening(VOICE[lang].pages[cmd.nav]));
    return go(cmd.nav);
  }
  const [key, value] = cmd.setting;
  if (key === 'lang') {
    const next = value === 'toggle' ? (lang === 'fr' ? 'en' : 'fr') : value;
    setLang(next);
    return say(VOICE[next].langToggle[next], { lang: next });
  }
  if (key === 'output') {
    setOutput(value);
    return say(STRINGS[lang].agent.SETTING({ key, value }), { output: value });
  }
  if (key === 'rate') {
    const next = value === 'slower' ? (rate === 'fast' ? 'normal' : 'slow') : (rate === 'slow' ? 'normal' : 'fast');
    setRate(next);
    return say(STRINGS[lang].agent.SETTING({ key, value }), { rate: next });
  }
}
