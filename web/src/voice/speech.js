// Everything about sound: listening (Web Speech API), speaking, and short earcons.
//
// Two ways for Kapyiŋi to talk, chosen on the first screen:
//   - "screenreader": text goes into an aria-live region and the user's own VoiceOver or
//     TalkBack reads it. Kapyiŋi never uses a second voice, so the user never hears two at once.
//   - "voice": Kapyiŋi reads its answers with speechSynthesis.

import { forSpeech } from '../lib/brand.js';

const Recognition = typeof window !== 'undefined' ? window.SpeechRecognition || window.webkitSpeechRecognition : null;

export const canListen = Boolean(Recognition);
export const canSpeak = typeof window !== 'undefined' && 'speechSynthesis' in window;

const LOCALES = { fr: 'fr-FR', en: 'en-US' };

/**
 * Listen to one sentence. Calls onInterim with partial text while the user speaks.
 * Resolves with the final text ('' if nothing was heard). Rejects with 'denied' or 'unavailable'.
 * Returns { promise, stop }.
 */
export function listenOnce({ lang, onInterim }) {
  if (!Recognition) return { promise: Promise.reject(new Error('unavailable')), stop() {} };
  const rec = new Recognition();
  rec.lang = LOCALES[lang] || 'fr-FR';
  rec.interimResults = true;
  rec.continuous = false;
  rec.maxAlternatives = 1;

  let finalText = '';
  let lastInterim = '';
  const promise = new Promise((resolve, reject) => {
    rec.onresult = (e) => {
      let interim = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        if (r.isFinal) finalText += r[0].transcript;
        else interim += r[0].transcript;
      }
      lastInterim = interim;
      onInterim?.((finalText + ' ' + interim).trim());
    };
    rec.onerror = (e) => {
      if (e.error === 'not-allowed' || e.error === 'service-not-allowed') reject(new Error('denied'));
      else if (e.error === 'no-speech' || e.error === 'aborted') resolve('');
      else reject(new Error(e.error || 'unavailable'));
    };
    rec.onend = () => resolve((finalText || lastInterim).trim());
  });
  try {
    rec.start();
  } catch {
    return { promise: Promise.reject(new Error('unavailable')), stop() {} };
  }
  return { promise, stop: () => { try { rec.stop(); } catch { /* already stopped */ } } };
}

/** Speak with Kapyiŋi's own voice. Resolves when finished (or at once if unsupported). */
const RATES = { slow: 0.78, normal: 0.95, fast: 1.15 };

export function speak(text, lang, rate = 'normal') {
  if (!canSpeak || !text) return Promise.resolve();
  window.speechSynthesis.cancel();
  return new Promise((resolve) => {
    const u = new SpeechSynthesisUtterance(forSpeech(text, lang));
    u.lang = LOCALES[lang] || 'fr-FR';
    u.rate = RATES[rate] || RATES.normal;
    const voice = window.speechSynthesis.getVoices().find((v) => v.lang?.startsWith(u.lang.slice(0, 2)));
    if (voice) u.voice = voice;
    u.onend = resolve;
    u.onerror = resolve;
    window.speechSynthesis.speak(u);
    // Some browsers never fire onend: do not block the conversation forever.
    setTimeout(resolve, 2000 + text.length * 90 / (RATES[rate] || 1));
  });
}

export function stopSpeaking() {
  if (canSpeak) window.speechSynthesis.cancel();
}

// ----- Earcons: a sound for each state, so a blind user knows what is happening without words. -----
let audio;
function tone(freqs, duration = 0.11) {
  try {
    audio ||= new (window.AudioContext || window.webkitAudioContext)();
    let t = audio.currentTime;
    for (const f of freqs) {
      const osc = audio.createOscillator();
      const gain = audio.createGain();
      osc.frequency.value = f;
      osc.type = 'sine';
      gain.gain.setValueAtTime(0.0001, t);
      gain.gain.exponentialRampToValueAtTime(0.18, t + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + duration);
      osc.connect(gain).connect(audio.destination);
      osc.start(t);
      osc.stop(t + duration + 0.02);
      t += duration * 0.9;
    }
  } catch { /* no audio: the words still say everything */ }
}
const buzz = (pattern) => { try { navigator.vibrate?.(pattern); } catch { /* ignore */ } };

export const earcon = {
  listen() { tone([660, 880]); buzz(30); },      // rising: "I'm listening"
  stop() { tone([880, 660]); },                 // falling: "I stopped listening"
  confirm() { tone([523, 659, 784], 0.13); buzz([20, 40, 20]); }, // a question about money: only for the confirmation step
  review() { tone([587, 740], 0.1); },           // a read-back: "check what I understood"
  success() { tone([523, 784, 1047], 0.16); buzz([40, 60, 40]); },
  problem() { tone([440, 330], 0.2); buzz([120]); },
};
