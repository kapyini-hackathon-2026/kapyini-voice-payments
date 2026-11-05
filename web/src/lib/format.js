export function money(value, currency, lang) {
  return new Intl.NumberFormat(lang === 'fr' ? 'fr-FR' : 'en-US', { style: 'currency', currency }).format(Number(value));
}
export const initials = (name = '') => name.split(/\s+/).map((w) => w[0]).slice(0, 2).join('').toUpperCase();
export const toneOf = (s) => ({ completed: 'go', failed: 'stop', cancelled: 'stop', pending: 'wait', unverified: 'wait' }[s] || '');
export const shortDate = (ts, lang) => new Date(ts).toLocaleString(lang, { dateStyle: 'medium', timeStyle: 'short' });

export async function api(path, { body, ...options } = {}) {
  let res;
  try {
    res = await fetch(path, {
      headers: { 'Content-Type': 'application/json' },
      ...(body !== undefined ? { method: 'POST', body: JSON.stringify(body) } : {}),
      ...options,
    });
  } catch {
    return { ok: false, errors: ['NETWORK'] };
  }
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, ...data };
}
