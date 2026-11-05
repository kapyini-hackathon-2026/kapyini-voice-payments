// Read an amount from what the user said, in digits ("30", "12,50 €") or in words
// ("trente euros", "quatre-vingt-dix", "twelve fifty", "douze euros cinquante").
// Deterministic on purpose: this is what decides whether a spoken confirmation
// matches the amount being sent. Returns cents, or null when no amount was said.
import { normalize } from './contacts.js';

const FR = {
  zero: 0, un: 1, une: 1, deux: 2, trois: 3, quatre: 4, cinq: 5, six: 6, sept: 7, huit: 8, neuf: 9,
  dix: 10, onze: 11, douze: 12, treize: 13, quatorze: 14, quinze: 15, seize: 16,
  vingt: 20, vingts: 20, trente: 30, quarante: 40, cinquante: 50, soixante: 60,
};
const EN = {
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9,
  ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16,
  seventeen: 17, eighteen: 18, nineteen: 19, twenty: 20, thirty: 30, forty: 40, fifty: 50,
  sixty: 60, seventy: 70, eighty: 80, ninety: 90,
};
const UNITS = { ...EN, ...FR };
const HUNDRED = new Set(['cent', 'cents', 'hundred']);
const THOUSAND = new Set(['mille', 'thousand']);
const GLUE = new Set(['et', 'and']);
const CURRENCY_WORDS = /^(euros?|eur|dollars?|usd|dirhams?|dh|mad|€|\$)$/;
const SEPARATORS = new Set(['virgule', 'point']);
const SUBUNIT = /^(centimes?|cents?)$/;

/** Parse one run of number words into an integer, or null. */
function wordsToNumber(words) {
  let total = 0;
  let current = 0;
  let seen = false;
  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    if (/^\d+$/.test(w)) { current += Number(w); seen = true; continue; }
    if (w in UNITS) {
      // "quatre vingt" = 80, not 4 + 20.
      if ((w === 'vingt' || w === 'vingts') && current % 100 === 4 && words[i - 1] === 'quatre') current += 76;
      else current += UNITS[w];
      seen = true;
      continue;
    }
    if (HUNDRED.has(w)) { current = (current || 1) * 100; seen = true; continue; }
    if (THOUSAND.has(w)) { total += (current || 1) * 1000; current = 0; seen = true; continue; }
    if (GLUE.has(w)) continue;
    return null;
  }
  return seen ? total + current : null;
}

const isNumberWord = (w) => /^\d+$/.test(w) || w in UNITS || HUNDRED.has(w) || THOUSAND.has(w);

export function parseSpokenAmount(text) {
  const s = normalize(text).replace(/€/g, ' euros ').replace(/\$/g, ' dollars ');

  // Digits first: "30", "30.5", "12,50".
  const digits = s.match(/(\d{1,6})(?:[.,](\d{1,2}))?/);
  if (digits) {
    const cents = digits[2] ? Number(digits[2].padEnd(2, '0')) : 0;
    // "30 euros 50" → 30.50
    const after = s.slice(digits.index + digits[0].length).trim().split(/\s+/);
    let extra = 0;
    if (!digits[2] && CURRENCY_WORDS.test(after[0] || '') && /^\d{1,2}$/.test(after[1] || '')) extra = Number(after[1]);
    return Number(digits[1]) * 100 + (cents || extra);
  }

  // Words: split into the integer run and an optional cents run.
  const words = s.split(/[\s-]+/).filter(Boolean);
  const start = words.findIndex(isNumberWord);
  if (start === -1) return null;
  let i = start;
  const whole = [];
  while (i < words.length && (isNumberWord(words[i]) || (GLUE.has(words[i]) && isNumberWord(words[i + 1] || '')))) whole.push(words[i++]);
  const units = wordsToNumber(whole);
  if (units === null) return null;

  // Optional "euros", "virgule", "et" before the cents.
  let sep = null;
  while (i < words.length && (CURRENCY_WORDS.test(words[i]) || SEPARATORS.has(words[i]) || GLUE.has(words[i]))) {
    if (SEPARATORS.has(words[i])) sep = words[i];
    i++;
  }
  const fraction = [];
  while (i < words.length && !SUBUNIT.test(words[i]) && (isNumberWord(words[i]) || GLUE.has(words[i]))) fraction.push(words[i++]);
  let cents = fraction.length ? wordsToNumber(fraction) : 0;
  if (cents === null || cents > 99) cents = 0;
  // "douze virgule cinq" = 12.50, not 12.05.
  if (sep && fraction.length === 1 && cents < 10) cents *= 10;
  return units * 100 + cents;
}
