// One-time build script: pulls MLB The Show pitcher cards and writes pitchers.json.
//
//   node fetch-data.js
//
// Output:
//   { pool: [ <Live pitcher cards> ], prime: { "<name>": <best non-Live card> } }
//
// "pool" = the cards the reel spins through (Live series only = real ratings).
// "prime" = highest-OVR special-edition card per player, used for the Boost.

const fs = require('fs');

const CONCURRENCY = 4;

// 2025 is the primary season (full card set, mature ratings, all tiers).
// 2026 is fetched as a supplement: a player's 2026 card replaces their 2025 card
// only if the 2026 OVR is strictly higher (dedup step in main()).
// Older seasons contribute gold-and-above (OVR >= 80) historical cards only.
const SOURCES = [
  { base: 'https://mlb25.theshow.com/apis/items.json', year: 2025, minOvr: 0,  prime: true }, // primary season
  { base: 'https://mlb26.theshow.com/apis/items.json', year: 2026, minOvr: 0 },               // upgrade if higher OVR
  { base: 'https://mlb24.theshow.com/apis/items.json', year: 2024, minOvr: 80 },
  { base: 'https://mlb23.theshow.com/apis/items.json', year: 2023, minOvr: 80 },
  { base: 'https://mlb22.theshow.com/apis/items.json', year: 2022, minOvr: 80 },
  { base: 'https://mlb21.theshow.com/apis/items.json', year: 2021, minOvr: 80 },
];

// Only the fields the game actually needs.
const ATTRS = [
  'pitch_velocity', 'pitch_movement', 'pitch_control',
  'k_per_bf', 'bb_per_bf', 'hr_per_bf', 'stamina', 'pitching_clutch',
  'fielding_ability', 'fielding_durability',
];

// name -> MLBAM player id (built in main), used for copyright-safe headshots.
let ID_MAP = {};
// Strip accents (Suárez -> suarez) and punctuation so MLB-The-Show names match MLB rosters.
const norm = s => s.normalize('NFD').replace(/[̀-ͯ]/g, '')
  .toLowerCase().replace(/[.'’-]/g, '').replace(/\s+/g, ' ').trim();

async function buildIdMap() {
  const map = {};
  for (const yr of [2021, 2022, 2023, 2024, 2025, 2026]) {
    try {
      const r = await fetch(`https://statsapi.mlb.com/api/v1/sports/1/players?season=${yr}`);
      const people = (await r.json()).people || [];
      for (const p of people) if (p.fullName) map[norm(p.fullName)] = p.id;
    } catch (e) { console.warn(`  roster ${yr} failed: ${e.message}`); }
  }
  return map;
}

// Card series that are current prospects, not retired greats — never legends.
const PROSPECT_SERIES = new Set(['2025 Draft', '2026 Draft', 'Pipeline', 'Pipeline Past', 'Spring Breakout']);

// Resolve a retired pitcher's MLBAM id via name search, choosing the earliest
// MLB debut among matches so a recent namesake never wins over the legend.
async function resolveLegendId(name) {
  try {
    const r = await fetch(`https://statsapi.mlb.com/api/v1/people/search?names=${encodeURIComponent(name)}`);
    const people = ((await r.json()).people || []).filter(p => p.mlbDebutDate);
    if (!people.length) return null;
    people.sort((a, b) => a.mlbDebutDate.localeCompare(b.mlbDebutDate));
    return people[0].id;
  } catch (e) { return null; }
}

// Resolve an active/current pitcher's MLBAM id via name search (catches accents,
// prospects, and anyone missing from the season rosters). Prefers an exact name
// match and the most recent MLB debut (the current player, not an old namesake).
async function resolveActiveId(name) {
  try {
    const r = await fetch(`https://statsapi.mlb.com/api/v1/people/search?names=${encodeURIComponent(name)}`);
    let people = (await r.json()).people || [];
    if (!people.length) return null;
    const exact = people.filter(p => norm(p.fullName) === norm(name));
    if (exact.length) people = exact;
    people.sort((a, b) => {
      if (!!b.active - !!a.active) return !!b.active - !!a.active;     // active first
      return (b.mlbDebutDate || '').localeCompare(a.mlbDebutDate || ''); // newest debut
    });
    return people[0].id;
  } catch (e) { return null; }
}

// Cy Young + World Series MVP winners — pitchers whose peak year guarantees them a Prime.
const AWARD_IDS = ['ALCY', 'NLCY', 'WSMVP'];
async function fetchAwardWinners() {
  const names = new Set();
  for (const id of AWARD_IDS) {
    for (let y = 2010; y <= 2025; y++) {
      try {
        const r = await fetch(`https://statsapi.mlb.com/api/v1/awards/${id}/recipients?sportId=1&season=${y}`);
        for (const a of ((await r.json()).awards || [])) {
          if (a.player && a.player.nameFirstLast) names.add(norm(a.player.nameFirstLast));
        }
      } catch (e) { /* skip a year/award that errors */ }
      await new Promise(r => setTimeout(r, 50));
    }
  }
  return names;
}

function slim(item, year) {
  const hm = String(item.height || '').match(/(\d+)'\s*(\d+)/); // "6'4\"" -> 76 in
  const out = {
    name: item.name,
    team: item.team_short_name || item.team,
    ovr: item.ovr,
    pos: item.display_position,
    mlbamId: ID_MAP[norm(item.name)] || null, // null -> game shows silhouette
    series: item.series,
    year,
    height: item.height || '',                  // display string for the Frame slot
    heightIn: hm ? (+hm[1] * 12 + +hm[2]) : null, // inches, drives Frame rating
  };
  // The Show 26 split some ratings into left/right (e.g. k_per_bf -> k_per_bf_left/right).
  // Use the single value when present, otherwise collapse the L/R split to one number.
  for (const a of ATTRS) {
    out[a] = item[a];
    if (out[a] == null) out[a] = avgLR(item[a + '_left'], item[a + '_right']);
  }
  return out;
}
const avgLR = (a, b) => {
  const xs = [a, b].map(Number).filter(v => !Number.isNaN(v));
  return xs.length ? Math.round(xs.reduce((s, v) => s + v, 0) / xs.length) : undefined;
};

async function getPage(base, page) {
  const url = `${base}?type=mlb_card&page=${page}`;
  for (let attempt = 0; attempt < 6; attempt++) {
    try {
      const res = await fetch(url);
      if (res.status === 429) throw new Error('HTTP 429'); // back off harder below
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } catch (err) {
      if (attempt === 5) throw err;
      const is429 = String(err.message).includes('429');
      const wait = (is429 ? 2000 : 500) * (attempt + 1) + Math.random() * 500;
      await new Promise(r => setTimeout(r, wait));
    }
  }
}

async function fetchAll(base) {
  const first = await getPage(base, 1);
  const totalPages = first.total_pages;
  const items = [...first.items];
  let next = 2;
  async function worker() {
    while (next <= totalPages) {
      const page = next++;
      const data = await getPage(base, page);
      for (const it of data.items) items.push(it);
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  return items;
}

// Drop pool players who have never appeared in an MLB game (prospects with Live cards but no debut).
// Primary signal: the MLB people API mlbDebutDate (absent = never debuted), keyed by MLBAM id.
// For players the roster map never matched (no id), the people-search is unreliable for prospect
// names, so fall back to a proxy: a real big-leaguer with a name variant still carries a gold+
// HISTORICAL card, whereas an undebuted prospect only exists as a single current-season card.
async function dropUndebuted(pool) {
  const CURRENT_SEASON = SOURCES[0].year;
  const ids = [...new Set(pool.map(p => p.mlbamId).filter(Boolean))];
  const debut = {};
  for (let i = 0; i < ids.length; i += 100) {
    try {
      const r = await fetch(`https://statsapi.mlb.com/api/v1/people?personIds=${ids.slice(i, i + 100).join(',')}`);
      for (const p of ((await r.json()).people || [])) debut[p.id] = p.mlbDebutDate || null;
    } catch (e) { /* leave undefined -> kept */ }
  }
  const hasHistorical = new Set(pool.filter(p => p.year && p.year < CURRENT_SEASON).map(p => p.name));
  const before = pool.length;
  const kept = pool.filter(p => p.mlbamId ? debut[p.mlbamId] !== null : hasHistorical.has(p.name));
  console.log(`Debut filter: dropped ${before - kept.length} undebuted prospects (kept ${kept.length})`);
  return kept;
}

async function main() {
  console.log('Building MLBAM id map (for headshots)...');
  ID_MAP = await buildIdMap();
  console.log(`  id map entries: ${Object.keys(ID_MAP).length}`);

  const pool = [];
  const prime = {};
  let legends = [];

  for (const src of SOURCES) {
    process.stdout.write(`Fetching ${src.year}... `);
    const items = await fetchAll(src.base);
    const pitchers = items.filter(it => it.is_hitter === false);
    // Starters + closers only (drop middle relief). Legends are exempt (built below).
    const live = pitchers.filter(it =>
      it.series === 'Live' && it.ovr >= src.minOvr && it.display_position !== 'RP');
    for (const it of live) pool.push(slim(it, src.year));
    console.log(`${pitchers.length} pitchers, +${live.length} to pool (OVR>=${src.minOvr})`);

    if (src.prime) {
      // Names with a current Live card = active players.
      const activeNames = new Set(pitchers.filter(it => it.series === 'Live').map(it => it.name));
      // Any player with a prospect/showcase card is a current prospect, NOT a retired legend —
      // exclude by NAME (their highest card may be a non-prospect special like "Neon"/"Spotlight").
      const prospectNames = new Set(pitchers.filter(it => PROSPECT_SERIES.has(it.series)).map(it => it.name));

      // Prime = highest-OVR special card per player name (used by the Boost power-up).
      const primeRaw = {};
      // Legend = highest-OVR special card for a player who has NO Live card (retired great).
      const legRaw = {};
      for (const it of pitchers) {
        if (it.series === 'Live') continue;
        if (!primeRaw[it.name] || it.ovr > primeRaw[it.name].ovr) primeRaw[it.name] = it;
        if (activeNames.has(it.name) || prospectNames.has(it.name)) continue; // active or prospect → not a legend
        if (!legRaw[it.name] || it.ovr > legRaw[it.name].ovr) legRaw[it.name] = it;
      }
      for (const name in primeRaw) prime[name] = slim(primeRaw[name], src.year);
      // Only the genuine all-time greats: 85+ OVR retired pitchers.
      legends = Object.values(legRaw).filter(it => it.ovr >= 85).map(it => {
        const s = slim(it, null); s.legend = true; return s;
      });
      console.log(`  Legends (85+ retired): ${legends.length} — resolving historical headshots...`);
      for (const lg of legends) {
        const id = await resolveLegendId(lg.name);
        if (id) lg.mlbamId = id;
        await new Promise(r => setTimeout(r, 120));
      }
      console.log(`  Legends with headshot: ${legends.filter(l => l.mlbamId).length}/${legends.length}`);
      console.log(`  Prime cards: ${Object.keys(prime).length}`);
    }
  }

  // Fallback pass: resolve headshots for any pool/prime pitcher the roster map missed
  // (accents, prospects, name variants) via the MLB people-search.
  const missing = {};
  for (const p of [...pool, ...Object.values(prime)]) {
    if (!p.mlbamId && !(p.name in missing)) missing[p.name] = null;
  }
  const missNames = Object.keys(missing);
  console.log(`\nResolving ${missNames.length} missing headshots via name search...`);
  let found = 0;
  for (const name of missNames) {
    const id = await resolveActiveId(name);
    if (id) { missing[name] = id; found++; }
    await new Promise(r => setTimeout(r, 110));
  }
  for (const p of [...pool, ...Object.values(prime)]) {
    if (!p.mlbamId && missing[p.name]) p.mlbamId = missing[p.name];
  }
  console.log(`  recovered ${found}/${missNames.length} ids`);

  // Per player name, keep the highest-OVR card; ties keep the first source (2025).
  const byName = new Map();
  for (const p of pool) {
    if (!byName.has(p.name) || p.ovr > byName.get(p.name).ovr) byName.set(p.name, p);
  }
  const debutedPool = await dropUndebuted([...byName.values()]);
  console.log(`\nSpin pool: ${debutedPool.length} cards | with headshot id: ${debutedPool.filter(p => p.mlbamId).length}`);

  // Guarantee a Prime for every Cy Young / WS MVP winner in the pool. If they have
  // no special-edition card, synthesize one by boosting their best Live card (+6).
  console.log('\nFetching Cy Young / WS MVP winners...');
  const awardNames = await fetchAwardWinners();
  console.log(`  award-winner names: ${awardNames.size}`);
  const bestLive = {};
  for (const p of debutedPool) { const n = norm(p.name); if (!bestLive[n] || p.ovr > bestLive[n].ovr) bestLive[n] = p; }
  let synth = 0;
  for (const n of awardNames) {
    const live = bestLive[n];
    if (!live || prime[live.name]) continue; // not in pool, or already has a real Prime
    const sp = { ...live };
    for (const k of ATTRS) if (typeof sp[k] === 'number') sp[k] = sp[k] + 6;
    sp.ovr = (live.ovr || 0) + 6;
    sp.synthPrime = true;
    prime[live.name] = sp;
    synth++;
  }
  console.log(`  synthesized ${synth} Primes for award winners without one (total Primes: ${Object.keys(prime).length})`);

  fs.writeFileSync('pitchers.json', JSON.stringify({ pool: debutedPool, prime, legends }));
  const kb = (fs.statSync('pitchers.json').size / 1024).toFixed(0);
  console.log(`Wrote pitchers.json (${kb} KB)`);
}

main().catch(err => { console.error(err); process.exit(1); });
