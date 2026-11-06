// Spoken commands handled in the browser, on every screen, without asking the server:
// moving between pages, changing the language, the voice or its speed, and "répète".
// They never touch money, so they can be decided here.

export const plain = (text) => String(text ?? '')
  .replace(/œ/gi, 'oe')
  .normalize('NFD').replace(/[̀-ͯ]/g, '')
  .toLowerCase()
  .replace(/[’']/g, ' ')
  .replace(/[^a-z0-9\s]/g, ' ')
  .replace(/\s+/g, ' ')
  .trim();

const GO = /^(ouvre|ouvrez|ouvrir|va|allez|aller|vas|affiche|affichez|afficher|montre|montrez|montrer|voir|je veux voir|emmene moi|amene moi|retourne|retournez|retourner|reviens|revenir|go|open|show|take me)\b/;
const PAGES = [
  ['#home', /\b(accueil|page principale|menu principal|menu|debut|home|main page|start)\b/],
  ['#activity', /\b(operations?|historique|history|transactions?|mes paiements|my payments|activite|activity)\b/],
  ['#invoices', /\b(factures?|demandes? de paiement|invoices?|bills?|payment requests?)\b/],
  ['#settings', /\b(reglages?|parametres?|settings|preferences|options)\b/],
  ['#people', /\b(contacts?|carnet d adresses|address book)\b/],
  ['#send', /\b(clavier|keyboard|envoi manuel|sans la voix)\b/],
];
const LANG_VERB = /(parle|parlez|parler|passe|passez|passer|mets|mettez|mettre|change|changez|changer|bascule|switch|speak|langue|language)/;

/**
 * @returns null, or one of:
 *   { nav: '#activity' } | { nav: 'back' } | { setting: ['lang', 'en'] } | { setting: ['rate', 'slower'] }
 *   | { setting: ['output', 'voice'] } | { repeat: true }
 */
export function localCommand(text) {
  const s = plain(text);
  if (!s) return null;
  const words = s.split(' ').length;

  // Language: "passe en anglais", "change la langue", "English".
  if ((LANG_VERB.test(s) && /\b(anglais|english)\b/.test(s)) || /^(en )?anglais$|^(in )?english$/.test(s)) return { setting: ['lang', 'en'] };
  if ((LANG_VERB.test(s) && /\b(francais|french)\b/.test(s)) || /^(en )?francais$|^(in )?french$/.test(s)) return { setting: ['lang', 'fr'] };
  if (/^(change|changer|changez) (la |de )?langue$|^change (the )?language$/.test(s)) return { setting: ['lang', 'toggle'] };

  // Voice and speed.
  if (/plus (lentement|doucement)|moins vite|ralenti|slower|slow down/.test(s)) return { setting: ['rate', 'slower'] };
  if (/plus vite|plus rapide|accelere|faster|speed up/.test(s)) return { setting: ['rate', 'faster'] };
  if (/lecteur d ecran|screen reader/.test(s) && /(utilise|active|prends|passe|use)/.test(s)) return { setting: ['output', 'screenreader'] };
  if (/(ta (propre )?voix|voix haute|your (own )?voice|read aloud)/.test(s)) return { setting: ['output', 'voice'] };

  // Going back.
  if (/^(retour|reviens|revenir|en arriere|page precedente|precedent|go back|back|previous page)$/.test(s)) return { nav: 'back' };

  // Pages: "ouvre mes opérations", "va aux réglages", "accueil", "réglages".
  for (const [hash, re] of PAGES) {
    if (!re.test(s)) continue;
    if (GO.test(s) || words <= 2 || /\b(page|ecran|screen)\b/.test(s)) return { nav: hash };
  }

  if (/^(repete[rz]?|tu peux repeter|redis|pardon|repeat|say (it|that) again|again)( s il (te|vous) plait| please)?$/.test(s)) return { repeat: true };
  return null;
}
