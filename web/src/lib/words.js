// Spell an amount out in words ("50.20 EUR" → "cinquante euros et vingt centimes").
// Shown under the figure on the confirmation screen: hearing or reading the amount
// a second, independent way is how people catch a misplaced comma.

const FR_UNITS = ['zéro', 'un', 'deux', 'trois', 'quatre', 'cinq', 'six', 'sept', 'huit', 'neuf', 'dix',
  'onze', 'douze', 'treize', 'quatorze', 'quinze', 'seize', 'dix-sept', 'dix-huit', 'dix-neuf'];
const FR_TENS = { 2: 'vingt', 3: 'trente', 4: 'quarante', 5: 'cinquante', 6: 'soixante', 8: 'quatre-vingt' };

function fr99(n) {
  if (n < 20) return FR_UNITS[n];
  const t = Math.floor(n / 10);
  const u = n % 10;
  if (t === 7 || t === 9) {
    const base = t === 7 ? 'soixante' : 'quatre-vingt';
    if (t === 7 && u === 1) return 'soixante et onze';
    return `${base}-${FR_UNITS[10 + u]}`;
  }
  if (u === 0) return t === 8 ? 'quatre-vingts' : FR_TENS[t];
  if (u === 1 && t !== 8) return `${FR_TENS[t]} et un`;
  return `${FR_TENS[t]}-${FR_UNITS[u]}`;
}

function fr999(n) {
  const h = Math.floor(n / 100);
  const r = n % 100;
  if (h === 0) return fr99(r);
  const hundreds = h === 1 ? 'cent' : `${FR_UNITS[h]} cent${r === 0 ? 's' : ''}`;
  return r ? `${hundreds} ${fr99(r)}` : hundreds;
}

function frInt(n) {
  if (n < 1000) return fr999(n);
  const th = Math.floor(n / 1000);
  const r = n % 1000;
  const thousands = th === 1 ? 'mille' : `${fr999(th).replace(/cents$/, 'cent').replace(/vingts$/, 'vingt')} mille`;
  return r ? `${thousands} ${fr999(r)}` : thousands;
}

const EN_UNITS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten',
  'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen'];
const EN_TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];

function en999(n) {
  const h = Math.floor(n / 100);
  const r = n % 100;
  const tail = r < 20 ? EN_UNITS[r] : `${EN_TENS[Math.floor(r / 10)]}${r % 10 ? `-${EN_UNITS[r % 10]}` : ''}`;
  if (h === 0) return tail;
  return r ? `${EN_UNITS[h]} hundred ${tail}` : `${EN_UNITS[h]} hundred`;
}

function enInt(n) {
  if (n < 1000) return en999(n);
  const th = Math.floor(n / 1000);
  const r = n % 1000;
  return r ? `${en999(th)} thousand ${en999(r)}` : `${en999(th)} thousand`;
}

const NAMES = {
  fr: { EUR: ['euro', 'euros', 'centime', 'centimes'], USD: ['dollar', 'dollars', 'cent', 'cents'] },
  en: { EUR: ['euro', 'euros', 'cent', 'cents'], USD: ['dollar', 'dollars', 'cent', 'cents'] },
};

/** @param {string} value "50.20"  @param {string} currency "EUR"  @param {'fr'|'en'} lang */
export function amountInWords(value, currency, lang = 'fr') {
  const cents = Math.round(Number(value) * 100);
  if (!Number.isFinite(cents) || cents < 0 || cents >= 100_000_000) return '';
  const whole = Math.floor(cents / 100);
  const frac = cents % 100;
  const [one, many, centOne, centMany] = NAMES[lang]?.[currency] || [currency, currency, '', ''];
  const spell = lang === 'en' ? enInt : frInt;
  // French: "deux euros", but "un million d'euros" is out of range here, so no "de" needed.
  const main = `${spell(whole)} ${whole === 1 ? one : many}`;
  if (!frac) return main;
  const joiner = lang === 'en' ? 'and' : 'et';
  return `${main} ${joiner} ${spell(frac)} ${frac === 1 ? centOne : centMany}`;
}
