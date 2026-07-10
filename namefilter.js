/* Name filter — blocks slurs/hate terms + hard profanity in user-chosen names
   (player names, team names, club names, guest handles).

   ONE source of truth for both sides:
     - Browser: loaded via <script src="/namefilter.js" defer> → window.NameFilter
       (friendly UX: catch it at the input before anything is saved/shown).
     - Server:  const NameFilter = require('../namefilter.js') in api/*.js
       (the real enforcement — client checks can be bypassed, these can't).

   Matching is evasion-resistant, not just a word list:
     - lowercased, accents stripped (NFKD), leetspeak mapped (n1gg3r, f@g…)
     - separators dropped ("n i g g e r", "n.i.g.g.e.r")
     - repeated letters collapsed ("Niggggggerkike" → "niggerkike")
   HARD terms match as a substring anywhere in the name; AMBIG terms only match
   as a whole word (so "raccoon", "Nigeria", "therapist", "Hancock" stay legal).

   API: isClean(name) → bool · bad(name) → matched term|null ·
        clean(name, fallback='Player') → name if clean else fallback */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.NameFilter = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // Blocked wherever they appear inside a name, even embedded ("xX<slur>69Xx").
  // Only terms with no innocent use inside a real name belong here.
  const HARD = [
    'nigger', 'nigga', 'niglet', 'nigglet', 'negroid',
    'kike', 'faggot', 'fagot', 'fagit', 'fagg',
    'wetback', 'beaner', 'porchmonkey', 'junglebunny', 'spearchucker',
    'towelhead', 'raghead', 'zipperhead', 'currymuncher', 'goatfucker',
    'chink', 'darkie', 'darky', 'tranny', 'shemale', 'ladyboy',
    'nazi', 'hitler', 'swastika', 'holohoax', 'lynchnig', 'kkk',
    'pedophile', 'paedophile', 'childmolest', 'molester',
    'cocksucker', 'cocksuck', 'dickhead', 'asshole', 'arsehole',
    'fuck', 'shit', 'bitch', 'whore', 'slut', 'jizz', 'penis', 'vagina',
    'fudgepacker', 'carpetmuncher', 'dyke',
  ];
  // Slurs/profanity that also live inside innocent words or real names —
  // matched only as a standalone word: coon→raccoon, spic→despicable,
  // niger→Nigeria, jap→Japan, paki→Pakistan, homo→homogeneous, nazi→Ashkenazi
  // is HARD anyway (accepted trade-off), cock→Hancock, cum→Cumberland,
  // fag→Fagundes, tard→mustard, gook→gobbledygook, negro→Montenegro,
  // cunt→Scunthorpe, rapist→therapist.
  const WORD = [
    'coon', 'coons', 'spic', 'spick', 'spik', 'gook', 'gooks',
    'fag', 'fags', 'homo', 'homos', 'jap', 'japs', 'paki', 'pakis',
    'negro', 'negros', 'negroes', 'niger', 'nigs', 'nig',
    'retard', 'retards', 'retarded', 'tard', 'tards',
    'cock', 'cocks', 'cum', 'tits', 'twat', 'twats',
    'rape', 'rapes', 'raped', 'rapist', 'rapists', 'cunt', 'cunts',
    'klan', 'anus', 'hoe', 'hoes', 'thot', 'thots',
  ];
  const WORD_SET = {};
  for (let i = 0; i < WORD.length; i++) WORD_SET[WORD[i]] = true;

  // leetspeak / symbol stand-ins → the letter they're read as
  const LEET = {
    '0': 'o', '1': 'i', '!': 'i', '|': 'i', '3': 'e', '4': 'a', '@': 'a',
    '5': 's', '$': 's', '7': 't', '+': 't', '8': 'b', '9': 'g', '6': 'g',
    '2': 'z', '€': 'e', '£': 'l',
  };

  // lowercase, de-accent, leet-map; non-letters become spaces (word breaks)
  function normalize(raw) {
    let s = String(raw == null ? '' : raw).toLowerCase();
    try { s = s.normalize('NFKD'); } catch (e) {}
    let out = '';
    for (let i = 0; i < s.length; i++) {
      const c = s[i];
      if (c >= 'a' && c <= 'z') out += c;
      else if (LEET[c]) out += LEET[c];
      else if (c >= '̀' && c <= 'ͯ') continue;   // combining accents
      else out += ' ';
    }
    return out;
  }
  const squeeze = (s, max) => s.replace(/(.)\1+/g, (m, c) => c.repeat(Math.min(m.length, max)));

  // the matched blocked term, or null if the name is clean
  function bad(raw) {
    const norm = normalize(raw);
    if (!norm.trim()) return null;
    const joined = norm.replace(/ +/g, '');       // separators dropped: "n i g g e r"
    // repeated-letter collapse: to 2 catches "Nigggggger"→"nigger"; to 1 catches "aasssshole";
    // an extra l→i pass catches lookalike swaps ("nlgger") without hiding real l-spellings
    const base = [joined, squeeze(joined, 2), squeeze(joined, 1)];
    const variants = base.concat(base.map(v => v.replace(/l/g, 'i')));
    for (let v = 0; v < variants.length; v++) {
      for (let i = 0; i < HARD.length; i++) {
        if (variants[v].indexOf(HARD[i]) !== -1) return HARD[i];
      }
    }
    const words = norm.split(/ +/);
    for (let w = 0; w < words.length; w++) {
      const word = words[w];
      if (!word) continue;
      if (WORD_SET[word]) return word;
      const c1 = squeeze(word, 1), c2 = squeeze(word, 2);
      if (WORD_SET[c2]) return c2;
      if (WORD_SET[c1]) return c1;
    }
    return null;
  }

  function isClean(raw) { return bad(raw) === null; }
  function clean(raw, fallback) {
    const s = String(raw == null ? '' : raw);
    return bad(s) === null ? s : (fallback === undefined ? 'Player' : fallback);
  }

  return { bad, isClean, clean };
});
