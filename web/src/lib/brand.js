// The agent's name. Written "Kapyiŋi" (ŋ = the "ng" of "parking"), "tree" in Senoufo.
// Speech engines do not know the letter ŋ, so the voice reads an approximate spelling instead.
// Listen to it on your phones and adjust SPOKEN until it sounds right.
export const NAME = 'Kapyiŋi';
export const SPOKEN = { fr: 'Kapyinghi', en: 'Kapyingee' };
export const forSpeech = (text, lang) => String(text).replace(/Kapyiŋi|KAPYIŊI/g, SPOKEN[lang] || SPOKEN.fr);
