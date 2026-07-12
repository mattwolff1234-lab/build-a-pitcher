// Bakes pokemon.json (Monster Lab's data) from PokeAPI's bulk CSVs (5 requests, no key,
// raw.githubusercontent.com/PokeAPI/pokeapi) - names, base stats, types, height, legendary flags.
// NO sprite/artwork URLs on purpose: Nintendo's art is the takedown risk, the stats/names are
// facts. Cards render a type-colored badge instead (see typeBadge() in the game page).
//   Ratings: base stat (5-255) -> clamp(round(stat*0.68 + 12), 1, 125). Real spread survives:
//   a 130+ base stat clears 100 (over-99 like Judge's 114), Blissey's 255 HP pins the 125 cap.
//   Pool  = default forms, BST >= 280, NOT legendary/mythical (those are the purple Legends).
//   Prime = the species' best special form (Mega/G-Max/etc.) when it beats base BST by 10+,
//           else synthesized +6/slot (ovr +5), same as CFB/hockey.
//   Legends = legendary + mythical species with BST >= 600 (Mewtwo, Rayquaza, Arceus tier);
//             sub-legendaries below that stay in the pool as strong regular cards.
//   Run: node fetch-pokemon.js

const fs = require('fs');

const BASE = 'https://raw.githubusercontent.com/PokeAPI/pokeapi/master/data/v2/csv/';
async function csv(name) {
  const r = await fetch(BASE + name);
  if (!r.ok) throw new Error(name + ' HTTP ' + r.status);
  const text = await r.text();
  const lines = text.trim().split('\n');
  const head = lines[0].split(',');
  return lines.slice(1).map(l => {
    const cells = l.split(',');   // no quoted commas in the columns we use
    const row = {};
    head.forEach((h, i) => row[h] = cells[i]);
    return row;
  });
}

const STAT_KEY = { 1: 'hp', 2: 'attack', 3: 'defense', 4: 'spatk', 5: 'spdef', 6: 'speed' };
const rate = stat => Math.max(1, Math.min(125, Math.round(stat * 0.68 + 12)));

const NAME_FIX = {
  'mr-mime': 'Mr. Mime', 'mr-rime': 'Mr. Rime', 'mime-jr': 'Mime Jr.', 'ho-oh': 'Ho-Oh',
  'farfetchd': "Farfetch'd", 'sirfetchd': "Sirfetch'd", 'porygon-z': 'Porygon-Z',
  'nidoran-f': 'Nidoran (F)', 'nidoran-m': 'Nidoran (M)', 'jangmo-o': 'Jangmo-o',
  'hakamo-o': 'Hakamo-o', 'kommo-o': 'Kommo-o', 'type-null': 'Type: Null',
  'tapu-koko': 'Tapu Koko', 'tapu-lele': 'Tapu Lele', 'tapu-bulu': 'Tapu Bulu', 'tapu-fini': 'Tapu Fini',
  'chi-yu': 'Chi-Yu', 'chien-pao': 'Chien-Pao', 'ting-lu': 'Ting-Lu', 'wo-chien': 'Wo-Chien',
};
const cap = s => s.charAt(0).toUpperCase() + s.slice(1);
const pretty = ident => NAME_FIX[ident] || ident.split('-').map(cap).join(' ');
function formName(ident, baseName) {
  if (ident.includes('-mega')) return ('Mega ' + baseName + (ident.endsWith('-x') ? ' X' : ident.endsWith('-y') ? ' Y' : '')).trim();
  if (ident.includes('-gmax')) return 'G-Max ' + baseName;
  if (ident.includes('-primal')) return 'Primal ' + baseName;
  return pretty(ident);
}

(async () => {
  const [pokemon, stats, species, ptypes, types] = await Promise.all([
    csv('pokemon.csv'), csv('pokemon_stats.csv'), csv('pokemon_species.csv'), csv('pokemon_types.csv'), csv('types.csv'),
  ]);

  const typeName = {}; for (const t of types) typeName[t.id] = t.identifier;
  const statsById = {};
  for (const s of stats) (statsById[s.pokemon_id] = statsById[s.pokemon_id] || {})[STAT_KEY[s.stat_id]] = +s.base_stat;
  const typesById = {};
  for (const t of ptypes) (typesById[t.pokemon_id] = typesById[t.pokemon_id] || [])[+t.slot - 1] = typeName[t.type_id];
  const speciesById = {}; for (const s of species) speciesById[s.id] = s;

  const KEYS = ['hp', 'attack', 'defense', 'spatk', 'spdef', 'speed'];
  const bstOf = st => KEYS.reduce((n, k) => n + (st[k] || 0), 0);

  function card(p, name) {
    const st = statsById[p.id] || {};
    const t = typesById[p.id] || [];
    const dm = +p.height || 10;   // decimeters
    const c = {
      name, team: (t[0] || 'normal').toUpperCase(),
      monId: +p.id,   // PokeAPI id -> sprite/artwork URLs in the page's headshot()
      types: t.filter(Boolean),
      pos: t.filter(Boolean).map(cap).join('/'),
      gen: +((speciesById[p.species_id] || {}).generation_id || 1),
      height: (dm / 10).toFixed(1) + ' m', heightIn: dm,
      bst: bstOf(st),
    };
    for (const k of KEYS) c[k] = rate(st[k] || 5);
    return c;
  }

  // --- card OVR: BST percentile through anchor points, so the tier spread matches the sibling
  // pools' feel (median bronze, diamonds = the true elite: pseudo-legendaries, UBs, paradoxes).
  // Slot ratings stay raw-stat-derived; only the tier/glow OVR is curved (hockey precedent).
  const OVR_ANCH = [[0, 45], [0.5, 68], [0.9, 82], [1, 99]];
  const ovrCurve = p => { for (let i = 1; i < OVR_ANCH.length; i++) { const [p0, r0] = OVR_ANCH[i - 1], [p1, r1] = OVR_ANCH[i]; if (p <= p1) return Math.round(r0 + (r1 - r0) * (p - p0) / (p1 - p0)); } return 99; };

  const defaults = pokemon.filter(p => p.is_default === '1' && +p.species_id <= 100000);
  const forms = pokemon.filter(p => p.is_default !== '1');

  const pool = [], legends = [];
  for (const p of defaults) {
    const sp = speciesById[p.species_id] || {};
    const c = card(p, pretty(sp.identifier || p.identifier));
    const isLeg = sp.is_legendary === '1' || sp.is_mythical === '1';
    if (isLeg && c.bst >= 600) { c.legend = true; c.ovr = Math.min(99, Math.round(85 + (c.bst - 600) * 0.115)); legends.push(c); }
    else if (c.bst >= 280) pool.push(c);
  }
  const bsts = pool.map(c => c.bst).sort((a, b) => a - b);
  const lo = v => { let a = 0, b = bsts.length; while (a < b) { const m = (a + b) >> 1; if (bsts[m] < v) a = m + 1; else b = m; } return a; };
  const hi = v => { let a = 0, b = bsts.length; while (a < b) { const m = (a + b) >> 1; if (bsts[m] <= v) a = m + 1; else b = m; } return a; };
  for (const c of pool) c.ovr = ovrCurve(((lo(c.bst) + hi(c.bst)) / 2) / bsts.length);
  pool.sort((a, b) => b.ovr - a.ovr);
  legends.sort((a, b) => b.ovr - a.ovr);

  // --- Primes: best special form per species (must beat base BST by 10+), else synth +6
  const bestForm = {};
  for (const f of forms) {
    const st = statsById[f.id]; if (!st) continue;
    const cur = bestForm[f.species_id];
    if (!cur || bstOf(st) > bstOf(statsById[cur.id])) bestForm[f.species_id] = f;
  }
  const bySpecies = {};
  for (const p of defaults) bySpecies[p.species_id] = p;
  const prime = {};
  const realPrimes = [];
  for (const c of pool.concat(legends)) {
    const sp = species.find(s => pretty(s.identifier) === c.name);
    const base = sp && bySpecies[sp.id];
    const f = sp && bestForm[sp.id];
    if (f && base && bstOf(statsById[f.id]) >= bstOf(statsById[base.id] || {}) + 10) {
      const pc = card(f, formName(f.identifier, c.name));
      pc.ovr = Math.min(99, Math.round(c.ovr + 5));
      pc.prime = true;
      prime[c.name] = pc;
      realPrimes.push(pc.name);
    } else {
      const pr = { ...c, ovr: Math.round(c.ovr + 5), synthPrime: true };
      for (const k of KEYS) pr[k] = Math.min(131, Math.round(pr[k] + 6));
      delete pr.legend;
      prime[c.name] = pr;
    }
  }

  fs.writeFileSync('pokemon.json', JSON.stringify({ pool, prime, legends }));

  const ovrs = pool.map(p => p.ovr);
  const tier = t => ovrs.filter(o => t[0] <= o && o <= t[1]).length;
  console.log(`Wrote pokemon.json: ${pool.length} pool, ${Object.keys(prime).length} primes (${realPrimes.length} real forms), ${legends.length} legends`);
  console.log(`OVR: top ${ovrs[0]} | median ${ovrs[Math.floor(ovrs.length / 2)]} | grey<=64 ${tier([0, 64])} bronze ${tier([65, 74])} silver ${tier([75, 79])} gold ${tier([80, 84])} diamond85+ ${tier([85, 200])}`);
  console.log('Top 10 pool: ' + pool.slice(0, 10).map(p => `${p.name}(${p.ovr})`).join(', '));
  console.log('Top 8 legends: ' + legends.slice(0, 8).map(p => `${p.name}(${p.ovr})`).join(', '));
  console.log('Real-form primes: ' + realPrimes.slice(0, 12).join(', ') + (realPrimes.length > 12 ? ` … +${realPrimes.length - 12}` : ''));
})();
