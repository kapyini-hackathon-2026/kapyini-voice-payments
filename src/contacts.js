// Find which saved contact a spoken name refers to. Deterministic: the AI may
// mishear or misspell a name, but only this code decides who gets the money.
//
// Speech recognition rarely spells a name the way it is saved ("Jon Do" for "John Doe",
// "Fatima Zara" for "Fatima Zahra", "Amin Bnali"). So names are compared by how they SOUND,
// with a tolerance that grows with the length of the word, and the whole sentence is scanned.

export function normalize(text) {
  return String(text ?? '').replace(/œ/gi, 'oe').replace(/æ/gi, 'ae')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[’']/g, ' ')
    .replace(/[^a-z0-9€$.,\s-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function levenshtein(a, b) {
  if (a === b) return 0;
  const row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let prev = row[0];
    row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = row[j];
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = tmp;
    }
  }
  return row[b.length];
}

// A rough "sounds like" key, tuned for French and English first names.
export function soundKey(word) {
  return word
    .replace(/ph/g, 'f')
    .replace(/qu|ck|q/g, 'k')
    .replace(/c(?=[eiy])/g, 's')
    .replace(/c/g, 'k')
    .replace(/dj|dg|g(?=[eiy])/g, 'j')
    .replace(/h/g, '')
    .replace(/y/g, 'i')
    .replace(/w/g, 'v')
    .replace(/eau|au/g, 'o')
    .replace(/ou|oo/g, 'u')
    .replace(/ee|ea/g, 'i')
    .replace(/(.)\1+/g, '$1')
    .replace(/(.{2,})[esdtx]$/, '$1'); // silent final letter: Doe → do, Amine → amin
}

/** How well a heard word matches a known name word: 1 = same, 0 = no match. */
export function wordScore(heard, known) {
  if (heard === known) return 1;
  const a = soundKey(heard);
  const b = soundKey(known);
  if (a === b) return 0.95;
  const longest = Math.max(a.length, b.length);
  if (longest < 3) return 0;
  const d = levenshtein(a, b);
  const allowed = longest >= 7 ? 2 : 1;
  if (d > allowed) return 0;
  return 1 - d / longest;
}

// Words of a request that are never a name.
const NOT_NAMES = new Set(`a au aux de des du d le la les l un une et ou en pour par sur avec mon ma mes ton ta tes son sa
  je j tu il elle nous vous on me moi te veux voudrais voudrai peux peut aimerais faut dois s si plait merci
  envoie envoies envoyer envoyez envoi envoye envois envoyes vire virer virement transfere transferer transfert paie paye payer
  donne donner verse verser rembourse rembourser argent euros euro dollars dollar dirhams dirham dh eur usd mad somme montant
  kapyini kapyingi kapingi kapiyingi kapinghi kapyinghi bonjour salut oui non stp svp alors maintenant tout suite vite please send pay to for the my some money and of
  quand meme ami amie personne
  zero deux trois quatre cinq six sept huit neuf dix onze douze treize quatorze quinze seize vingt trente quarante cinquante
  soixante cent cents mille one two three four five six seven eight nine ten twenty thirty forty fifty hundred thousand`.split(/\s+/));

/** The words of a sentence that could be (part of) a name. */
export function candidateWords(text) {
  return normalize(text).split(/[\s,.-]+/).filter((w) => w.length >= 2 && !/\d/.test(w) && !NOT_NAMES.has(w));
}

/**
 * @returns the contacts that best match what was heard: 0, 1 or several (several = ask which one).
 * `heardName` may be a bare name or a whole sentence ("envoie vingt euros à Jon Do").
 */
export function resolveContacts(heardName, contacts) {
  const normalized = ` ${normalize(heardName).replace(/-/g, ' ')} `;
  // A nickname the user chose ("mon frère", "maman") names exactly one person.
  const byAlias = contacts.filter((c) => (c.aliases || []).some((a) => normalized.includes(` ${normalize(a).replace(/-/g, ' ')} `)));
  if (byAlias.length) return byAlias;

  const words = candidateWords(heardName);
  // "Jondo" said as one word: also try the words glued two by two, and the whole name glued.
  const glued = words.slice(0, -1).map((w, i) => w + words[i + 1]);
  const pool = [...words, ...glued];
  if (!pool.length) return [];
  const scored = contacts.map((c) => {
    const nameWords = normalize(c.name).split(/[\s-]+/).filter(Boolean);
    let matched = 0;
    let total = 0;
    for (const n of nameWords) {
      const best = Math.max(0, ...pool.map((w) => wordScore(w, n)));
      if (best > 0) { matched += 1; total += best; }
    }
    const whole = Math.max(0, ...pool.map((w) => wordScore(w, nameWords.join(''))));
    if (whole > 0 && matched < nameWords.length) { matched = nameWords.length; total = whole * nameWords.length; }
    return { c, matched, total };
  }).filter((s) => s.matched > 0);
  if (!scored.length) return [];

  const most = Math.max(...scored.map((s) => s.matched));
  const top = scored.filter((s) => s.matched === most).sort((x, y) => y.total - x.total);
  // A clearly better sound match wins; otherwise all are returned and Kapyiŋi asks which one.
  if (top.length > 1 && top[0].total - top[1].total >= 0.15) return [top[0].c];
  return top.map((s) => s.c);
}
