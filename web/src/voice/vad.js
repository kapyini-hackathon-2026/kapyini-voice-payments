// Interrupting Kapyiŋi by talking ("barge-in"): while Kapyiŋi speaks, the microphone is watched
// for a voice. When one is heard, Kapyiŋi stops talking and listens.
//
// How: Web Audio measures the sound energy (RMS) of the microphone, with the browser's echo
// cancellation on. Kapyiŋi's own voice still leaks into the microphone on a phone speaker, so the
// first moments of each sentence set a baseline, and only a sound clearly above it, held for
// about 250 ms, counts as the user speaking.
//
// Limits (to check on real phones):
//   - The microphone is released before speech recognition starts: on mobile both cannot
//     use it at once. The first syllable said may be lost.
//   - iPhone (Safari): opening the microphone switches the audio to "call" mode, which makes
//     Kapyiŋi's voice quieter. Off by default there; the user can turn it on in Settings.
//   - Never used with a screen reader: we cannot know when VoiceOver or TalkBack talks.

import { read, write } from '../storage.js';

const AudioCtx = typeof window !== 'undefined' ? window.AudioContext || window.webkitAudioContext : null;

export const canDetectVoice = Boolean(AudioCtx && typeof navigator !== 'undefined' && navigator.mediaDevices?.getUserMedia);

export const isIOS = typeof navigator !== 'undefined'
  && (/iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1));

// The user's choice on this device; by default on, except on iPhone (see above).
export const bargeInOn = () => {
  if (!canDetectVoice) return false;
  const saved = read('kapyini-bargein');
  return saved ? saved === 'on' : !isIOS;
};
export const setBargeIn = (on) => write('kapyini-bargein', on ? 'on' : 'off');

// Tuning: change these after testing on phones.
const CALIBRATE_MS = 350; // the start of each sentence sets the baseline (Kapyiŋi's own voice)
const VOICE_MS = 250; // how long a voice must be heard within the window below
const WINDOW_MS = 400;
const MIN_LEVEL = 0.02; // never trigger below this level (RMS, 0..1)
const OVER_BASELINE = 2.6; // a voice must be this many times louder than the baseline
const TICK_MS = 30;

/**
 * Watch the microphone while Kapyiŋi speaks. Calls onVoice() once when the user starts talking.
 * Returns stop(), which releases the microphone (always call it when Kapyiŋi stops speaking).
 */
export function watchForVoice({ onVoice }) {
  let stopped = false;
  let stream;
  let ctx;
  let timer;

  const stop = () => {
    stopped = true;
    clearInterval(timer);
    try { stream?.getTracks().forEach((t) => t.stop()); } catch { /* ignore */ }
    try { ctx?.close(); } catch { /* ignore */ }
  };

  (async () => {
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: false } });
    } catch {
      return; // no microphone access: touching the disc still interrupts
    }
    if (stopped) { stop(); return; }
    ctx = new AudioCtx();
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 1024;
    ctx.createMediaStreamSource(stream).connect(analyser);
    const data = new Float32Array(analyser.fftSize);

    const startedAt = performance.now();
    const baseline = [];
    let threshold = MIN_LEVEL;
    const loud = []; // timestamps of loud ticks within the window

    timer = setInterval(() => {
      if (stopped) return;
      analyser.getFloatTimeDomainData(data);
      let sum = 0;
      for (let i = 0; i < data.length; i++) sum += data[i] * data[i];
      const rms = Math.sqrt(sum / data.length);
      const now = performance.now();

      if (now - startedAt < CALIBRATE_MS) {
        baseline.push(rms);
        return;
      }
      if (baseline.length) {
        const sorted = [...baseline].sort((a, b) => a - b);
        const median = sorted[Math.floor(sorted.length / 2)];
        threshold = Math.max(MIN_LEVEL, median * OVER_BASELINE);
        baseline.length = 0;
      }
      if (rms > threshold) loud.push(now);
      while (loud.length && now - loud[0] > WINDOW_MS) loud.shift();
      if (loud.length * TICK_MS >= VOICE_MS) {
        stop();
        onVoice();
      }
    }, TICK_MS);
  })();

  return stop;
}

// Speech recognition may hear Kapyiŋi's own last sentence. A transcript of 4 words or more,
// almost all found in what Kapyiŋi just said, is taken as that echo and ignored.
const words = (s) => String(s ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(Boolean);
export function isEcho(heard, spoken) {
  const h = words(heard);
  if (h.length < 4) return false;
  const said = new Set(words(spoken));
  return h.filter((w) => said.has(w)).length / h.length >= 0.8;
}
