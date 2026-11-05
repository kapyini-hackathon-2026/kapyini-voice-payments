// Per-device conveniences only (language, how Kapyiŋi talks). Never anything about money.
export function read(key, fallback = null) {
  try { return localStorage.getItem(key) ?? fallback; } catch { return fallback; }
}
export function write(key, value) {
  try { localStorage.setItem(key, value); } catch { /* private mode: keep it in memory */ }
}
export function readSession(key) {
  try { return sessionStorage.getItem(key); } catch { return null; }
}
export function writeSession(key, value) {
  try { sessionStorage.setItem(key, value); } catch { /* ignore */ }
}
