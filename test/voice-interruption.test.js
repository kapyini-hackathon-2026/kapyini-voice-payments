// Exercise the real VAD against simulated Web Audio energy and a controlled clock.
// This verifies detection/resource handling, not acoustic quality on a physical phone.
import { test } from 'node:test';
import assert from 'node:assert/strict';

let moduleId = 0;
function replaceGlobal(t, key, value) {
  const original = Object.getOwnPropertyDescriptor(globalThis, key);
  Object.defineProperty(globalThis, key, { configurable: true, value });
  t.after(() => {
    if (original) Object.defineProperty(globalThis, key, original);
    else delete globalThis[key];
  });
}

async function microphone(t, { ios = false, denied = false, deferred = false } = {}) {
  let now = 0;
  let level = 0;
  let tick;
  let resolveAccess;
  const track = { stop: t.mock.fn() };
  const stream = { getTracks: () => [track] };
  const close = t.mock.fn();
  class AudioContext {
    createAnalyser() {
      return { fftSize: 1024, getFloatTimeDomainData: (data) => data.fill(level) };
    }
    createMediaStreamSource() { return { connect() {} }; }
    close() { close(); }
  }
  const getUserMedia = t.mock.fn(() => denied
    ? Promise.reject(new Error('permission denied'))
    : deferred ? new Promise((resolve) => { resolveAccess = resolve; }) : Promise.resolve(stream));
  replaceGlobal(t, 'window', { AudioContext });
  replaceGlobal(t, 'navigator', {
    userAgent: ios ? 'iPhone' : 'Android', platform: ios ? 'iPhone' : 'Linux',
    maxTouchPoints: 1, mediaDevices: { getUserMedia },
  });
  const saved = new Map();
  replaceGlobal(t, 'localStorage', { getItem: (key) => saved.get(key) ?? null, setItem: (key, value) => saved.set(key, value) });
  t.mock.method(performance, 'now', () => now);
  t.mock.method(globalThis, 'setInterval', (fn) => { tick = fn; return 1; });
  t.mock.method(globalThis, 'clearInterval', () => { tick = null; });
  const vad = await import(`../web/src/voice/vad.js?qa=${++moduleId}`);
  return {
    vad, track, close, getUserMedia,
    grant: () => resolveAccess(stream),
    sample(value, duration) {
      level = value;
      for (let elapsed = 0; elapsed < duration; elapsed += 30) { now += 30; tick?.(); }
    },
  };
}

test('steady speaker echo and a short noise burst do not trigger interruption', async (t) => {
  const mic = await microphone(t);
  const onVoice = t.mock.fn();
  const stop = mic.vad.watchForVoice({ onVoice });
  t.after(stop);
  await Promise.resolve();
  mic.sample(0.03, 1500);
  mic.sample(0.15, 90);
  mic.sample(0.03, 600);
  assert.equal(onVoice.mock.callCount(), 0);
  assert.equal(mic.track.stop.mock.callCount(), 0);
});

test('sustained speech above the echo baseline interrupts once and releases the microphone', async (t) => {
  const mic = await microphone(t);
  const onVoice = t.mock.fn();
  const stop = mic.vad.watchForVoice({ onVoice });
  t.after(stop);
  await Promise.resolve();
  assert.deepEqual(mic.getUserMedia.mock.calls[0].arguments[0], {
    audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: false },
  });
  mic.sample(0.03, 600);
  mic.sample(0.15, 600);
  assert.equal(onVoice.mock.callCount(), 1);
  assert.equal(mic.track.stop.mock.callCount(), 1);
  assert.equal(mic.close.mock.callCount(), 1);
  mic.sample(0.15, 1000);
  assert.equal(onVoice.mock.callCount(), 1);
});

test('stopping while microphone permission is pending releases a late stream', async (t) => {
  const mic = await microphone(t, { deferred: true });
  const onVoice = t.mock.fn();
  const stop = mic.vad.watchForVoice({ onVoice });
  stop();
  mic.grant();
  await Promise.resolve();
  assert.equal(mic.track.stop.mock.callCount(), 1);
  assert.equal(mic.close.mock.callCount(), 0);
  assert.equal(onVoice.mock.callCount(), 0);
});

test('denied microphone access does not trigger a voice interruption', async (t) => {
  const mic = await microphone(t, { denied: true });
  const onVoice = t.mock.fn();
  const stop = mic.vad.watchForVoice({ onVoice });
  await Promise.resolve();
  stop();
  assert.equal(onVoice.mock.callCount(), 0);
  assert.equal(mic.track.stop.mock.callCount(), 0);
});

test('iPhone interruption defaults off and respects the explicit device setting', async (t) => {
  const { vad } = await microphone(t, { ios: true });
  assert.equal(vad.bargeInOn(), false);
  vad.setBargeIn(true);
  assert.equal(vad.bargeInOn(), true);
  vad.setBargeIn(false);
  assert.equal(vad.bargeInOn(), false);
});

test('supported non-iOS devices default to voice interruption and can turn it off', async (t) => {
  const { vad } = await microphone(t);
  assert.equal(vad.bargeInOn(), true);
  vad.setBargeIn(false);
  assert.equal(vad.bargeInOn(), false);
});
